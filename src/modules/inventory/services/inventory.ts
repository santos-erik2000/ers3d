// Estoque de peças (Etapa 5, Sprint 8 — épico E7, histórias INV-1/INV-2). Ver
// o cabeçalho de `InventoryItem`/`InventoryMovement` em prisma/schema.prisma
// para o desenho completo e a explicação de por que
// `createInventoryItemFromProductionInTx` pode ser chamada diretamente por
// src/modules/quality/services/quality.ts (`submitQualityCheck`), dentro da
// mesma transação do registro do checklist, sem fechar um ciclo entre
// módulos: este módulo não importa nada de `quality`, `crm` ou `production` —
// só `audit`, exatamente como `filaments`. Diferente do caso quotes/production
// (Sprint 6) e quality/opportunities (Sprint 7) — onde o módulo de destino já
// dependia de volta do módulo de origem —, aqui não há dependência de volta
// nenhuma, então reaproveitar a função normalmente (em vez de duplicar a
// lógica de criação dentro de `quality.ts`) é a escolha certa.
//
// Escrita condicional atômica (INV-2, caso crítico explícito "Venda ou
// descarte sem estoque" — planejamento/02 §05): toda operação que reduz
// `quantityAvailable` (RESERVA, VENDA, DESCARTE, e AJUSTE quando negativo)
// usa `updateMany` com um filtro de saldo mínimo no próprio WHERE — nunca um
// "ler saldo, decidir, escrever" em passos separados. Isso é o que garante
// que, sob concorrência, só uma operação vence quando o saldo é insuficiente
// para as duas ao mesmo tempo — mesmo desenho de
// src/modules/filaments/services/filaments.ts (`recordMovementInTx`), agora
// estendido para as quatro colunas relevantes de uma peça
// (disponível/reservado/vendido/descartado) em vez de só uma.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  Prisma,
  type InventoryItem,
  type InventoryItemStatus,
  type InventoryMovement,
  type InventoryMovementType,
} from "@prisma/client";

export class BusinessRuleError extends Error {}

function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BusinessRuleError(`Informe uma quantidade inteira maior que zero para ${field}.`);
  }
  return value;
}

// --- geração automática a partir da aprovação de qualidade (INV-1) ----------

export type CreateInventoryItemFromProductionInput = {
  opportunityId: string;
  // Nulo quando a ordem de produção de origem não tinha job vinculado
  // (orçamento manual) — ver TODO em `quantityProduced` abaixo.
  jobId: string | null;
  qualityCheckId: string;
  // Vem de `Job.quantityProduced` quando há job. TODO (limitação documentada,
  // não um bug): quando não há job (orçamento manual, sem Job de origem), não
  // existe um campo de "quantidade produzida" confiável para inferir — o
  // chamador usa 1 como fallback (ver comentário em
  // src/modules/quality/services/quality.ts, `submitQualityCheck`). Uma
  // evolução futura seria pedir a quantidade manualmente nesse caso, em vez
  // de assumir 1.
  quantityProduced: number;
  // `Job.directCost / Job.quantityProduced` quando há job (custo de produção
  // real — filamento + energia —, nunca o preço de venda); nulo no fallback
  // manual, pelo mesmo motivo do TODO acima — não inventamos um custo que
  // não temos como calcular.
  unitCost: Prisma.Decimal | null;
};

/**
 * Cria o `InventoryItem` correspondente a uma aprovação de qualidade (INV-1)
 * e grava o `PRODUCAO` inicial (disponível 0 → quantityProduced) — tudo
 * dentro do `tx` já aberto pelo chamador, para que a criação da peça em
 * estoque seja atômica com o próprio registro do checklist de qualidade que
 * a originou (se qualquer parte falhar, nada é gravado).
 */
export async function createInventoryItemFromProductionInTx(
  tx: Prisma.TransactionClient,
  input: CreateInventoryItemFromProductionInput,
  actorUserId: string,
): Promise<InventoryItem> {
  const quantityProduced = requirePositiveInt(input.quantityProduced, "a quantidade produzida");

  const item = await tx.inventoryItem.create({
    data: {
      opportunityId: input.opportunityId,
      jobId: input.jobId,
      qualityCheckId: input.qualityCheckId,
      quantityProduced,
      quantityAvailable: quantityProduced,
      quantityReserved: 0,
      quantitySold: 0,
      quantityDiscarded: 0,
      unitCost: input.unitCost,
      status: "ACTIVE",
    },
  });

  await tx.inventoryMovement.create({
    data: {
      inventoryItemId: item.id,
      type: "PRODUCAO",
      quantity: quantityProduced,
      availableBefore: 0,
      availableAfter: quantityProduced,
      reservedBefore: 0,
      reservedAfter: 0,
      soldBefore: 0,
      soldAfter: 0,
      discardedBefore: 0,
      discardedAfter: 0,
      userId: actorUserId,
    },
  });

  await recordAudit(
    {
      entityType: "inventory_item",
      entityId: item.id,
      action: "inventory_item.create",
      after: {
        opportunityId: input.opportunityId,
        jobId: input.jobId,
        qualityCheckId: input.qualityCheckId,
        quantityProduced,
        unitCost: input.unitCost?.toString() ?? null,
      },
      userId: actorUserId,
    },
    tx,
  );

  return item;
}

// --- movimentações manuais (reservar/liberar/vender/descartar/ajustar) ------

export type RecordInventoryMovementInput = {
  inventoryItemId: string;
  type: Exclude<InventoryMovementType, "PRODUCAO">;
  // Magnitude sempre positiva para RESERVA/LIBERACAO_RESERVA/VENDA/DESCARTE;
  // para AJUSTE é o delta já assinado aplicado a `quantityAvailable` (pode
  // ser negativo), nunca zero.
  quantity: number;
  reason?: string | null;
};

/**
 * Núcleo transacional — recebe um `tx` já aberto para poder ser reaproveitado
 * dentro da transação de uma operação maior no futuro (mesmo padrão de
 * `recordMovementInTx` em filaments.ts), embora hoje só seja chamada
 * standalone (`recordInventoryMovement`) pela tela de estoque de peças.
 *
 * Nunca permite `quantityAvailable` (nem `quantityReserved`, para
 * LIBERACAO_RESERVA) ficar negativo (INV-2) — a checagem de saldo suficiente
 * é parte da própria escrita condicional (`updateMany` com filtro no WHERE),
 * não uma leitura separada anterior à escrita.
 */
export async function recordInventoryMovementInTx(
  tx: Prisma.TransactionClient,
  input: RecordInventoryMovementInput,
  actorUserId: string,
): Promise<{ item: InventoryItem; movement: InventoryMovement }> {
  const item = await tx.inventoryItem.findUnique({ where: { id: input.inventoryItemId } });
  if (!item) throw new BusinessRuleError("Item de estoque não encontrado.");

  const reason = input.reason?.trim() || null;

  let availableDelta = 0;
  let reservedDelta = 0;
  let soldDelta = 0;
  let discardedDelta = 0;
  let where: Prisma.InventoryItemWhereInput = { id: input.inventoryItemId };
  let movementQuantity: number;

  switch (input.type) {
    case "RESERVA": {
      const qty = requirePositiveInt(input.quantity, "a reserva");
      availableDelta = -qty;
      reservedDelta = qty;
      where = { id: input.inventoryItemId, quantityAvailable: { gte: qty } };
      movementQuantity = qty;
      break;
    }
    case "LIBERACAO_RESERVA": {
      const qty = requirePositiveInt(input.quantity, "a liberação de reserva");
      reservedDelta = -qty;
      availableDelta = qty;
      where = { id: input.inventoryItemId, quantityReserved: { gte: qty } };
      movementQuantity = qty;
      break;
    }
    case "VENDA": {
      const qty = requirePositiveInt(input.quantity, "a venda");
      availableDelta = -qty;
      soldDelta = qty;
      where = { id: input.inventoryItemId, quantityAvailable: { gte: qty } };
      movementQuantity = qty;
      break;
    }
    case "DESCARTE": {
      const qty = requirePositiveInt(input.quantity, "o descarte");
      availableDelta = -qty;
      discardedDelta = qty;
      where = { id: input.inventoryItemId, quantityAvailable: { gte: qty } };
      movementQuantity = qty;
      break;
    }
    case "AJUSTE": {
      if (!Number.isInteger(input.quantity) || input.quantity === 0) {
        throw new BusinessRuleError("Informe uma quantidade inteira diferente de zero para o ajuste.");
      }
      if (!reason) {
        throw new BusinessRuleError("Informe a justificativa do ajuste de estoque.");
      }
      availableDelta = input.quantity;
      const minimumRequired = input.quantity < 0 ? -input.quantity : 0;
      where = { id: input.inventoryItemId, quantityAvailable: { gte: minimumRequired } };
      movementQuantity = Math.abs(input.quantity);
      break;
    }
    default:
      throw new BusinessRuleError("Tipo de movimentação inválido.");
  }

  const updateResult = await tx.inventoryItem.updateMany({
    where,
    data: {
      quantityAvailable: { increment: availableDelta },
      quantityReserved: { increment: reservedDelta },
      quantitySold: { increment: soldDelta },
      quantityDiscarded: { increment: discardedDelta },
      version: { increment: 1 },
    },
  });

  if (updateResult.count === 0) {
    if (input.type === "LIBERACAO_RESERVA") {
      throw new BusinessRuleError(
        `Reserva insuficiente: o item tem ${item.quantityReserved} unidade(s) reservada(s) — não é possível liberar mais do que isso.`,
      );
    }
    throw new BusinessRuleError(
      `Estoque insuficiente: o item tem ${item.quantityAvailable} unidade(s) disponível(is) — a operação exigiria mais do que isso.`,
    );
  }

  const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id: input.inventoryItemId } });

  const movement = await tx.inventoryMovement.create({
    data: {
      inventoryItemId: input.inventoryItemId,
      type: input.type,
      quantity: movementQuantity,
      availableBefore: updated.quantityAvailable - availableDelta,
      availableAfter: updated.quantityAvailable,
      reservedBefore: updated.quantityReserved - reservedDelta,
      reservedAfter: updated.quantityReserved,
      soldBefore: updated.quantitySold - soldDelta,
      soldAfter: updated.quantitySold,
      discardedBefore: updated.quantityDiscarded - discardedDelta,
      discardedAfter: updated.quantityDiscarded,
      reason,
      userId: actorUserId,
    },
  });

  await recordAudit(
    {
      entityType: "inventory_item",
      entityId: input.inventoryItemId,
      action: `inventory_item.movement.${input.type.toLowerCase()}`,
      before: { quantityAvailable: item.quantityAvailable, quantityReserved: item.quantityReserved },
      after: { quantityAvailable: updated.quantityAvailable, quantityReserved: updated.quantityReserved },
      reason: reason ?? undefined,
      userId: actorUserId,
    },
    tx,
  );

  return { item: updated, movement };
}

/** Versão standalone de `recordInventoryMovementInTx` — abre sua própria transação (tela de estoque de peças). */
export async function recordInventoryMovement(
  input: RecordInventoryMovementInput,
  actorUserId: string,
): Promise<{ item: InventoryItem; movement: InventoryMovement }> {
  return prisma.$transaction((tx) => recordInventoryMovementInTx(tx, input, actorUserId));
}

// --- atalhos nomeados por operação (usados pelas Server Actions) -----------

export async function reserveItem(inventoryItemId: string, quantity: number, actorUserId: string, reason?: string | null) {
  return recordInventoryMovement({ inventoryItemId, type: "RESERVA", quantity, reason }, actorUserId);
}

export async function releaseReservation(
  inventoryItemId: string,
  quantity: number,
  actorUserId: string,
  reason?: string | null,
) {
  return recordInventoryMovement({ inventoryItemId, type: "LIBERACAO_RESERVA", quantity, reason }, actorUserId);
}

/** Venda (INV-2): sempre debita `quantityAvailable`, nunca `quantityReserved` diretamente — libere a reserva antes, se for o caso. */
export async function sellItem(inventoryItemId: string, quantity: number, actorUserId: string, reason?: string | null) {
  return recordInventoryMovement({ inventoryItemId, type: "VENDA", quantity, reason }, actorUserId);
}

/** Descarte (INV-2): mesma disciplina de saldo suficiente da venda. */
export async function discardItem(
  inventoryItemId: string,
  quantity: number,
  actorUserId: string,
  reason?: string | null,
) {
  return recordInventoryMovement({ inventoryItemId, type: "DESCARTE", quantity, reason }, actorUserId);
}

/** Ajuste manual — sempre exige justificativa (validado em `recordInventoryMovementInTx`). */
export async function adjustItem(inventoryItemId: string, delta: number, actorUserId: string, reason: string) {
  return recordInventoryMovement({ inventoryItemId, type: "AJUSTE", quantity: delta, reason }, actorUserId);
}

// --- cadastro (status/localização) ------------------------------------------

export type UpdateInventoryItemMetaInput = {
  location?: string | null;
  status?: InventoryItemStatus;
};

/** Edita só metadados não-numéricos (localização, status) — nunca as quantidades, que só mudam via movimentação. */
export async function updateInventoryItemMeta(
  id: string,
  input: UpdateInventoryItemMetaInput,
  actorUserId: string,
): Promise<InventoryItem> {
  const before = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!before) throw new BusinessRuleError("Item de estoque não encontrado.");

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.inventoryItem.update({
      where: { id },
      data: {
        location: input.location === undefined ? before.location : input.location?.trim() || null,
        status: input.status ?? before.status,
      },
    });

    await recordAudit(
      {
        entityType: "inventory_item",
        entityId: id,
        action: "inventory_item.update",
        before: { location: before.location, status: before.status },
        after: { location: after.location, status: after.status },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

// --- leitura ------------------------------------------------------------------

export async function listInventoryItemsByOpportunity(opportunityId: string) {
  return prisma.inventoryItem.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
}

/** Visão agregada de todo o estoque de peças (todas as oportunidades) — base da rota /estoque-pecas. */
export async function listAllInventoryItems() {
  return prisma.inventoryItem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      opportunity: { select: { id: true, title: true } },
    },
  });
}

export async function listInventoryMovements(inventoryItemId?: string, limit = 50) {
  return prisma.inventoryMovement.findMany({
    where: inventoryItemId ? { inventoryItemId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      inventoryItem: { select: { id: true, opportunityId: true } },
      user: { select: { id: true, name: true } },
    },
  });
}
