import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  Prisma,
  type Filament,
  type FilamentMovement,
  type FilamentMovementType,
  type FilamentStatus,
} from "@prisma/client";

export class BusinessRuleError extends Error {}

// --- entradas -----------------------------------------------------------------

export type FilamentInput = {
  name: string;
  brand?: string | null;
  material: string;
  color?: string | null;
  batch?: string | null;
  supplier?: string | null;
  pricePerKg: Prisma.Decimal.Value;
  initialWeightGrams: Prisma.Decimal.Value;
  minStockGrams: Prisma.Decimal.Value;
  purchaseDate?: Date | null;
  location?: string | null;
  status?: FilamentStatus;
  notes?: string | null;
};

// `availableGrams` só existe na criação (saldo inicial informado pelo
// usuário) — na edição não é aceito aqui de propósito: alterar o saldo
// corrente tem que passar por `recordMovement`, para manter o histórico de
// saldo anterior/posterior e a regra de nunca ficar negativo. Ver comentário
// em `updateFilament`.
export type CreateFilamentInput = FilamentInput & { availableGrams: Prisma.Decimal.Value };

function toDecimal(value: Prisma.Decimal.Value, field: string): Prisma.Decimal {
  let decimal: Prisma.Decimal;
  try {
    decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    throw new BusinessRuleError(`Valor inválido para ${field}.`);
  }
  if (decimal.isNaN()) throw new BusinessRuleError(`Valor inválido para ${field}.`);
  return decimal;
}

type NormalizedFilamentMeta = {
  name: string;
  brand: string | null;
  material: string;
  color: string | null;
  batch: string | null;
  supplier: string | null;
  pricePerKg: Prisma.Decimal;
  initialWeightGrams: Prisma.Decimal;
  minStockGrams: Prisma.Decimal;
  purchaseDate: Date | null;
  location: string | null;
  status: FilamentStatus;
  notes: string | null;
};

function normalizeMeta(input: FilamentInput): NormalizedFilamentMeta {
  const name = input.name.trim();
  if (!name) throw new BusinessRuleError("Informe o nome do filamento.");
  const material = input.material.trim();
  if (!material) throw new BusinessRuleError("Informe o material do filamento.");

  const pricePerKg = toDecimal(input.pricePerKg, "preço por kg");
  if (pricePerKg.lessThan(0)) throw new BusinessRuleError("Preço por kg não pode ser negativo.");

  const initialWeightGrams = toDecimal(input.initialWeightGrams, "peso inicial");
  if (initialWeightGrams.lessThan(0)) throw new BusinessRuleError("Peso inicial não pode ser negativo.");

  const minStockGrams = toDecimal(input.minStockGrams, "estoque mínimo");
  if (minStockGrams.lessThan(0)) throw new BusinessRuleError("Estoque mínimo não pode ser negativo.");

  return {
    name,
    brand: input.brand?.trim() || null,
    material,
    color: input.color?.trim() || null,
    batch: input.batch?.trim() || null,
    supplier: input.supplier?.trim() || null,
    pricePerKg,
    initialWeightGrams,
    minStockGrams,
    purchaseDate: input.purchaseDate ?? null,
    location: input.location?.trim() || null,
    status: input.status ?? "ACTIVE",
    notes: input.notes?.trim() || null,
  };
}

// --- CRUD -----------------------------------------------------------------

export async function createFilament(input: CreateFilamentInput, actorUserId: string): Promise<Filament> {
  const meta = normalizeMeta(input);
  const availableGrams = toDecimal(input.availableGrams, "gramas disponíveis");
  if (availableGrams.lessThan(0)) throw new BusinessRuleError("Gramas disponíveis não podem ser negativas.");

  const created = await prisma.$transaction(async (tx) => {
    const filament = await tx.filament.create({ data: { ...meta, availableGrams } });

    await recordAudit(
      {
        entityType: "filament",
        entityId: filament.id,
        action: "filament.create",
        after: {
          name: meta.name,
          material: meta.material,
          pricePerKg: meta.pricePerKg.toString(),
          initialWeightGrams: meta.initialWeightGrams.toString(),
          availableGrams: availableGrams.toString(),
          minStockGrams: meta.minStockGrams.toString(),
        },
        userId: actorUserId,
      },
      tx,
    );

    return filament;
  });

  return created;
}

/**
 * Atualiza os dados cadastrais do filamento. Nunca aceita `availableGrams`
 * (o saldo corrente) — alterar o saldo é sempre uma `recordMovement`
 * (tipicamente um "Ajuste"/"Correção"), para preservar o histórico de saldo
 * anterior/posterior e nunca abrir uma porta para o saldo ficar negativo sem
 * passar pela checagem transacional daquela função.
 */
export async function updateFilament(id: string, input: FilamentInput, actorUserId: string): Promise<Filament> {
  const before = await prisma.filament.findUnique({ where: { id } });
  if (!before) throw new BusinessRuleError("Filamento não encontrado.");

  const meta = normalizeMeta(input);

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.filament.update({ where: { id }, data: meta });

    await recordAudit(
      {
        entityType: "filament",
        entityId: id,
        action: "filament.update",
        before: {
          name: before.name,
          pricePerKg: before.pricePerKg.toString(),
          minStockGrams: before.minStockGrams.toString(),
          status: before.status,
        },
        after: {
          name: after.name,
          pricePerKg: after.pricePerKg.toString(),
          minStockGrams: after.minStockGrams.toString(),
          status: after.status,
        },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

export async function listFilaments() {
  return prisma.filament.findMany({ orderBy: { name: "asc" } });
}

export async function getFilamentById(id: string) {
  return prisma.filament.findUnique({ where: { id } });
}

export function isLowStock(filament: Pick<Filament, "availableGrams" | "minStockGrams">): boolean {
  return filament.availableGrams.lessThan(filament.minStockGrams);
}

// --- movimentações de estoque ------------------------------------------------

export type RecordMovementInput = {
  filamentId: string;
  type: FilamentMovementType;
  // Magnitude sempre positiva informada pelo usuário para ENTRADA/PERDA/
  // DEVOLUCAO/RESERVA/LIBERACAO_RESERVA (o sinal é implícito no tipo); para
  // AJUSTE/CORRECAO é o delta já assinado (pode ser negativo, ex.: -15 para
  // reduzir 15g), nunca zero.
  quantityGrams: Prisma.Decimal.Value;
  reason?: string | null;
  // Preenchido só quando a movimentação (RESERVA/LIBERACAO_RESERVA) é
  // originada de uma ordem de produção (Sprint 6) — rastreabilidade.
  productionOrderId?: string | null;
};

/**
 * Resolve o delta assinado (positivo aumenta o saldo, negativo reduz) a
 * partir do tipo de movimentação e da quantidade informada pelo usuário.
 * Entrada/Devolução/Liberação de reserva sempre somam; Perda/Reserva sempre
 * subtraem; Ajuste/Correção aceitam o delta diretamente (pode ir em qualquer
 * direção), mas nunca zero (isso não seria uma movimentação real).
 *
 * RESERVA (Sprint 6 — PROD-1) debita o saldo disponível tanto na reserva
 * inicial (aprovação do orçamento) quanto no consumo adicional na conclusão
 * da produção, quando as gramas reais excedem o estimado — é sempre um
 * débito, igual PERDA. LIBERACAO_RESERVA (Sprint 6 — PROD-3) credita de
 * volta quando as gramas reais são menores que o reservado — sempre um
 * crédito, igual ENTRADA/DEVOLUCAO. Ver src/modules/quotes/services/quotes.ts
 * (`approveVersion`) e src/modules/production/services/production.ts
 * (`completeProduction`).
 */
function resolveDelta(type: FilamentMovementType, quantityGrams: Prisma.Decimal): Prisma.Decimal {
  switch (type) {
    case "ENTRADA":
    case "DEVOLUCAO":
    case "LIBERACAO_RESERVA":
      if (quantityGrams.lessThanOrEqualTo(0)) {
        throw new BusinessRuleError("A quantidade da movimentação deve ser maior que zero.");
      }
      return quantityGrams;
    case "PERDA":
    case "RESERVA":
      if (quantityGrams.lessThanOrEqualTo(0)) {
        throw new BusinessRuleError("A quantidade da movimentação deve ser maior que zero.");
      }
      return quantityGrams.negated();
    case "AJUSTE":
    case "CORRECAO":
      if (quantityGrams.isZero()) {
        throw new BusinessRuleError("Informe uma quantidade diferente de zero para o ajuste/correção.");
      }
      return quantityGrams;
    default:
      throw new BusinessRuleError("Tipo de movimentação inválido.");
  }
}

/**
 * Núcleo transacional de `recordMovement` — recebe um `tx` já aberto (em vez
 * de abrir sua própria transação) para poder ser reaproveitado DENTRO da
 * transação de outra operação de negócio maior, sem duplicar a lógica de
 * saldo (regra do CLAUDE.md: reaproveitar `recordMovement`, não recriar).
 * Usado tanto por `recordMovement` (abre sua própria transação, uso
 * standalone da tela de estoque) quanto por
 * src/modules/quotes/services/quotes.ts (`approveVersion` — reserva
 * atômica de cada filamento do job, tudo ou nada com a aprovação da versão)
 * e src/modules/production/services/production.ts (`completeProduction` —
 * conversão de reserva em consumo real, tudo ou nada com a conclusão).
 *
 * Nunca permite o saldo ficar negativo (PROD-5, caso crítico da Etapa 2 §05:
 * "impedir consumo/reserva de filamento sem saldo"). A checagem de saldo
 * suficiente é feita como parte da própria escrita condicional no banco
 * (`updateMany` com filtro `availableGrams >= mínimo necessário`), não como
 * um "ler saldo, decidir, escrever" separado — isso é o que garante que, sob
 * concorrência (dois usuários/duas reservas mexendo no mesmo filamento ao
 * mesmo tempo), só uma das duas operações vence e a outra recebe erro de
 * saldo insuficiente, nunca as duas passando e o saldo indo negativo.
 *
 * `balanceBefore`/`balanceAfter` são gravados a partir do saldo real lido
 * de volta do banco DEPOIS da escrita bem-sucedida (dentro da mesma
 * transação) — nunca de uma leitura feita antes da escrita, que poderia
 * estar desatualizada.
 */
export async function recordMovementInTx(
  tx: Prisma.TransactionClient,
  input: RecordMovementInput,
  actorUserId: string,
): Promise<{ filament: Filament; movement: FilamentMovement }> {
  const quantityGrams = toDecimal(input.quantityGrams, "quantidade");
  const delta = resolveDelta(input.type, quantityGrams);
  const reason = input.reason?.trim() || null;

  const filament = await tx.filament.findUnique({ where: { id: input.filamentId } });
  if (!filament) throw new BusinessRuleError("Filamento não encontrado.");

  // Se delta é negativo, precisamos de availableGrams >= |delta| para não
  // ficar negativo; se é positivo, qualquer saldo atual serve (>= 0).
  const minimumRequired = delta.isNegative() ? delta.negated() : new Prisma.Decimal(0);

  const updateResult = await tx.filament.updateMany({
    where: { id: input.filamentId, availableGrams: { gte: minimumRequired } },
    data: { availableGrams: { increment: delta }, version: { increment: 1 } },
  });

  if (updateResult.count === 0) {
    throw new BusinessRuleError(
      `Saldo insuficiente: o filamento "${filament.name}" tem ${filament.availableGrams.toString()}g ` +
        `disponíveis, e esta movimentação exigiria reduzir ${minimumRequired.toString()}g.`,
    );
  }

  const updatedFilament = await tx.filament.findUniqueOrThrow({ where: { id: input.filamentId } });
  const balanceAfter = updatedFilament.availableGrams;
  const balanceBefore = balanceAfter.minus(delta);

  const movement = await tx.filamentMovement.create({
    data: {
      filamentId: input.filamentId,
      type: input.type,
      quantityGrams: delta,
      balanceBefore,
      balanceAfter,
      reason,
      userId: actorUserId,
      productionOrderId: input.productionOrderId ?? null,
    },
  });

  await recordAudit(
    {
      entityType: "filament",
      entityId: input.filamentId,
      action: `filament.movement.${input.type.toLowerCase()}`,
      before: { availableGrams: balanceBefore.toString() },
      after: { availableGrams: balanceAfter.toString() },
      reason: reason ?? undefined,
      userId: actorUserId,
    },
    tx,
  );

  return { filament: updatedFilament, movement };
}

/**
 * Registra uma movimentação de estoque de filamento em uma transação
 * própria — uso standalone (tela de estoque, Sprint 4). Ver
 * `recordMovementInTx` para o núcleo reaproveitado por outros módulos dentro
 * de uma transação maior.
 */
export async function recordMovement(
  input: RecordMovementInput,
  actorUserId: string,
): Promise<{ filament: Filament; movement: FilamentMovement }> {
  return prisma.$transaction((tx) => recordMovementInTx(tx, input, actorUserId));
}

export async function listMovements(filamentId?: string, limit = 50) {
  return prisma.filamentMovement.findMany({
    where: filamentId ? { filamentId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      filament: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
}
