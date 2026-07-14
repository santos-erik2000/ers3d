// Entrega (Etapa 5, Sprint 8 — épico E7, histórias DEL-1/DEL-2). Ver o
// cabeçalho de `Delivery`/`DeliveryChecklistItem` em prisma/schema.prisma
// para o desenho completo (método, checklist de embalagem, comprovante como
// texto/URL — mesma decisão do Sprint 7 para evidência de qualidade).
//
// Este módulo não importa nada de `crm`/`quality`/`production` — só `audit`,
// mesmo padrão de `filaments`/`inventory`. `src/modules/crm/services/
// opportunities.ts` é quem importa `hasDeliveredDelivery` daqui (pré-condição
// real de Entrega → Concluído), na mesma direção já usada para
// `hasApprovedQualityCheck`/`hasCompletedProductionOrder` — sem ciclo.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { DELIVERY_CHECKLIST_ITEMS } from "@/modules/deliveries/format";
import type { Delivery, DeliveryMethod } from "@prisma/client";

export class BusinessRuleError extends Error {}

const VALID_METHODS: DeliveryMethod[] = ["RETIRADA", "ENTREGA_PROPRIA", "CORREIOS", "TRANSPORTADORA", "MOTOBOY"];

// --- criação (DEL-1) ---------------------------------------------------------

export type CreateDeliveryInput = {
  opportunityId: string;
  method: DeliveryMethod;
  address?: string | null;
  recipientName?: string | null;
  trackingCode?: string | null;
  expectedAt?: Date | null;
  notes?: string | null;
};

/**
 * Registra uma nova entrega (DEL-1) — exige que a oportunidade já esteja na
 * etapa Entrega (mesma disciplina de `submitQualityCheck` exigir a etapa
 * Qualidade): não faz sentido registrar entrega de uma oportunidade que ainda
 * não passou por qualidade/produção. Cria junto o checklist de embalagem fixo
 * (DELIVERY_CHECKLIST_ITEMS), todos desmarcados. Uma oportunidade pode
 * acumular mais de uma Delivery ao longo do tempo (ex.: reenvio após
 * extravio) — a pré-condição de Entrega → Concluído sempre olha a MAIS
 * RECENTE (`hasDeliveredDelivery`), nunca "existe alguma ENTREGUE alguma
 * vez", mesmo padrão de `hasApprovedQualityCheck`/`hasCompletedProductionOrder`.
 */
export async function createDelivery(input: CreateDeliveryInput, actorUserId: string): Promise<Delivery> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");
  if (opportunity.stage !== "ENTREGA") {
    throw new BusinessRuleError("Só é possível registrar entrega quando a oportunidade está na etapa Entrega.");
  }
  if (!VALID_METHODS.includes(input.method)) {
    throw new BusinessRuleError("Método de entrega inválido.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.create({
      data: {
        opportunityId: input.opportunityId,
        method: input.method,
        status: "PENDENTE",
        address: input.address?.trim() || null,
        recipientName: input.recipientName?.trim() || null,
        trackingCode: input.trackingCode?.trim() || null,
        expectedAt: input.expectedAt ?? null,
        notes: input.notes?.trim() || null,
        createdById: actorUserId,
        checklistItems: {
          create: DELIVERY_CHECKLIST_ITEMS.map((label) => ({ label, checked: false })),
        },
      },
    });

    await recordAudit(
      {
        entityType: "delivery",
        entityId: delivery.id,
        action: "delivery.create",
        after: { opportunityId: input.opportunityId, method: input.method },
        userId: actorUserId,
      },
      tx,
    );

    return delivery;
  });

  return created;
}

// --- edição de dados + checklist ---------------------------------------------

export type UpdateDeliveryChecklistInput = { id: string; checked: boolean; notes?: string | null };

export type UpdateDeliveryInput = {
  method?: DeliveryMethod;
  address?: string | null;
  recipientName?: string | null;
  trackingCode?: string | null;
  expectedAt?: Date | null;
  notes?: string | null;
  proofUrl?: string | null;
  checklist?: UpdateDeliveryChecklistInput[];
};

/**
 * Atualiza os dados da entrega (método, endereço, responsável pelo
 * recebimento, rastreio, prazo previsto, observações, comprovante) e/ou o
 * estado do checklist de embalagem — uma entrega já com status ENTREGUE não
 * pode mais ser editada (mesma trava de `updateProductionOrderDetails` em
 * production.ts para uma ordem já CONCLUIDA).
 */
export async function updateDelivery(
  deliveryId: string,
  input: UpdateDeliveryInput,
  actorUserId: string,
): Promise<Delivery> {
  const before = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { checklistItems: true },
  });
  if (!before) throw new BusinessRuleError("Entrega não encontrada.");
  if (before.status === "ENTREGUE") {
    throw new BusinessRuleError("Esta entrega já foi confirmada como entregue e não pode mais ser editada.");
  }
  if (input.method && !VALID_METHODS.includes(input.method)) {
    throw new BusinessRuleError("Método de entrega inválido.");
  }

  const validItemIds = new Set(before.checklistItems.map((i) => i.id));
  const checklistUpdates = (input.checklist ?? []).filter((c) => validItemIds.has(c.id));

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        method: input.method ?? before.method,
        address: input.address === undefined ? before.address : input.address?.trim() || null,
        recipientName:
          input.recipientName === undefined ? before.recipientName : input.recipientName?.trim() || null,
        trackingCode: input.trackingCode === undefined ? before.trackingCode : input.trackingCode?.trim() || null,
        expectedAt: input.expectedAt === undefined ? before.expectedAt : input.expectedAt,
        notes: input.notes === undefined ? before.notes : input.notes?.trim() || null,
        proofUrl: input.proofUrl === undefined ? before.proofUrl : input.proofUrl?.trim() || null,
      },
    });

    for (const item of checklistUpdates) {
      await tx.deliveryChecklistItem.update({
        where: { id: item.id },
        data: { checked: item.checked, notes: item.notes?.trim() || null },
      });
    }

    await recordAudit(
      {
        entityType: "delivery",
        entityId: deliveryId,
        action: "delivery.update",
        before: { method: before.method },
        after: { method: after.method },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

// --- transições de status (DEL-2 depende de status ENTREGUE) ----------------

/** Marca a entrega como enviada (status ENVIADO), registrando `shippedAt`. */
export async function markDeliveryAsShipped(deliveryId: string, actorUserId: string): Promise<Delivery> {
  const before = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!before) throw new BusinessRuleError("Entrega não encontrada.");
  if (before.status !== "PENDENTE") {
    throw new BusinessRuleError("Só é possível marcar como enviada uma entrega pendente.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: "ENVIADO", shippedAt: new Date() },
    });

    await recordAudit(
      {
        entityType: "delivery",
        entityId: deliveryId,
        action: "delivery.ship",
        before: { status: before.status },
        after: { status: "ENVIADO" },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

/**
 * Marca a entrega como concluída (status ENTREGUE, `deliveredAt`) — a partir
 * de PENDENTE (métodos sem etapa de envio, ex. RETIRADA) ou ENVIADO. É esta
 * transição que passa a alimentar a pré-condição real de Entrega → Concluído
 * (`hasDeliveredDelivery`, usada em
 * src/modules/crm/services/opportunities.ts, `validateTransition`).
 */
export async function markDeliveryAsDelivered(
  deliveryId: string,
  actorUserId: string,
  proofUrl?: string | null,
): Promise<Delivery> {
  const before = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!before) throw new BusinessRuleError("Entrega não encontrada.");
  if (before.status === "ENTREGUE") {
    throw new BusinessRuleError("Esta entrega já está marcada como entregue.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "ENTREGUE",
        deliveredAt: new Date(),
        proofUrl: proofUrl === undefined ? before.proofUrl : proofUrl?.trim() || before.proofUrl,
      },
    });

    await recordAudit(
      {
        entityType: "delivery",
        entityId: deliveryId,
        action: "delivery.deliver",
        before: { status: before.status },
        after: { status: "ENTREGUE" },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

// --- leitura --------------------------------------------------------------------

/**
 * Existe uma Delivery MAIS RECENTE (por `createdAt`) da oportunidade com
 * `status = ENTREGUE`? Usado por src/modules/crm/services/opportunities.ts
 * (`moveStage`) para popular a pré-condição real de Entrega → Concluído —
 * mesma disciplina de "sempre a mais recente" de `hasApprovedQualityCheck`/
 * `hasCompletedProductionOrder`: uma nova Delivery ainda pendente não deve
 * reaproveitar o status ENTREGUE de uma Delivery anterior (ex.: reenvio após
 * extravio, a entrega antiga tinha sido confirmada, mas a nova ainda não).
 */
export async function hasDeliveredDelivery(opportunityId: string): Promise<boolean> {
  const latest = await prisma.delivery.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  return latest?.status === "ENTREGUE";
}

/** Entrega mais recente da oportunidade, com o checklist de embalagem — base do painel de entrega em /crm/[id]. */
export async function getDeliveryByOpportunity(opportunityId: string) {
  return prisma.delivery.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    include: {
      checklistItems: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
}

