// Produção (Etapa 5, Sprint 6 — épico E5, histórias PROD-1..PROD-5). Ver
// cabeçalho de `ProductionOrder` em prisma/schema.prisma para o desenho
// completo e a política de estoque (reserva na aprovação, decisão já
// confirmada na Etapa 1 §03).
//
// A criação AUTOMÁTICA da ordem de produção (quando a QuoteVersion aprovada
// veio de um Job) e a reserva do filamento estimado vivem em
// src/modules/quotes/services/quotes.ts (`approveVersion`) — não aqui —
// porque precisam acontecer NA MESMA TRANSAÇÃO da aprovação da versão (se
// qualquer filamento não tiver saldo, a aprovação inteira falha, nada é
// aprovado e nenhuma ordem é criada). Este módulo cobre:
//   - a criação MANUAL de uma ordem (versão de orçamento sem job — TODO
//     documentado em `approveVersion`);
//   - a edição dos dados técnicos (impressora, responsável, datas, status de
//     impressão) de uma ordem já existente;
//   - a conclusão da produção (`completeProduction` — PROD-3), que converte
//     a reserva em consumo real com as gramas reais apontadas, reconciliando
//     a diferença para o estimado (a mais consome, a menos libera) — sempre
//     em transação, tudo ou nada (mesmo caso crítico "Editar job já com
//     estoque reservado" da Etapa 2 §05, só que no momento da conclusão em
//     vez de uma edição de job, já que `Job` é imutável neste sistema).

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError as FilamentBusinessRuleError,
  recordMovementInTx,
} from "@/modules/filaments/services/filaments";
import { hasApprovedQuoteVersion } from "@/modules/quotes/services/quotes";
import { Prisma, type ProductionOrder, type ProductionPrintStatus } from "@prisma/client";

export class BusinessRuleError extends Error {}

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

// Status que podem ser definidos manualmente via `updateProductionOrderDetails`
// — CONCLUIDA só é alcançável através de `completeProduction`, nunca por uma
// edição direta de status (é o que aciona a reconciliação de estoque).
const MANUALLY_SETTABLE_STATUSES: ProductionPrintStatus[] = ["AGUARDANDO", "IMPRIMINDO", "FALHOU"];

// --- criação -----------------------------------------------------------------

export type CreateManualProductionOrderInput = {
  opportunityId: string;
  printerId?: string | null;
  responsibleId?: string | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  technicalNotes?: string | null;
};

/**
 * Cria uma ordem de produção manualmente — caminho para quando a QuoteVersion
 * aprovada da oportunidade é MANUAL (sem Job de origem), caso em que
 * `approveVersion` não gera nada automaticamente (não há job para estimar
 * filamentos). Não reserva estoque nenhum — se a impressão dessa ordem usar
 * filamento, o usuário registra manualmente em `/estoque` (mesma tela do
 * Sprint 4). Exige que a oportunidade já tenha uma QuoteVersion aprovada
 * (mesma pré-condição de negócio da criação automática) e que ainda não
 * exista nenhuma ordem de produção para esta oportunidade.
 */
export async function createManualProductionOrder(
  input: CreateManualProductionOrderInput,
  actorUserId: string,
): Promise<ProductionOrder> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");

  const approved = await hasApprovedQuoteVersion(input.opportunityId);
  if (!approved) {
    throw new BusinessRuleError(
      "É necessário ter uma versão de orçamento aprovada antes de criar a ordem de produção.",
    );
  }

  const existing = await prisma.productionOrder.findFirst({ where: { opportunityId: input.opportunityId } });
  if (existing) {
    throw new BusinessRuleError("Já existe uma ordem de produção para esta oportunidade.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.productionOrder.create({
      data: {
        opportunityId: input.opportunityId,
        jobId: null,
        printerId: input.printerId || null,
        responsibleId: input.responsibleId || null,
        plannedStartAt: input.plannedStartAt ?? null,
        plannedEndAt: input.plannedEndAt ?? null,
        technicalNotes: input.technicalNotes?.trim() || null,
        printStatus: "AGUARDANDO",
      },
    });

    await recordAudit(
      {
        entityType: "production_order",
        entityId: order.id,
        action: "production_order.create",
        after: { opportunityId: input.opportunityId, source: "manual" },
        userId: actorUserId,
      },
      tx,
    );

    return order;
  });

  return created;
}

// --- edição de dados técnicos --------------------------------------------------

export type UpdateProductionOrderInput = {
  printerId?: string | null;
  responsibleId?: string | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  technicalNotes?: string | null;
  printStatus?: ProductionPrintStatus;
};

/**
 * Atualiza os dados técnicos de uma ordem (impressora, responsável, datas
 * previstas, observações, status de impressão) — nunca aceita `CONCLUIDA`
 * como `printStatus` aqui (só `completeProduction` alcança esse estado, é o
 * que faz a reconciliação de estoque). Uma ordem já concluída não pode mais
 * ser editada (estoque já foi consumido em definitivo).
 */
export async function updateProductionOrderDetails(
  orderId: string,
  input: UpdateProductionOrderInput,
  actorUserId: string,
): Promise<ProductionOrder> {
  const before = await prisma.productionOrder.findUnique({ where: { id: orderId } });
  if (!before) throw new BusinessRuleError("Ordem de produção não encontrada.");
  if (before.printStatus === "CONCLUIDA") {
    throw new BusinessRuleError("Esta ordem de produção já foi concluída e não pode mais ser editada.");
  }
  if (input.printStatus && !MANUALLY_SETTABLE_STATUSES.includes(input.printStatus)) {
    throw new BusinessRuleError(
      "Status de impressão inválido para edição manual — conclua a produção pelo formulário de conclusão.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        printerId: input.printerId === undefined ? before.printerId : input.printerId,
        responsibleId: input.responsibleId === undefined ? before.responsibleId : input.responsibleId,
        plannedStartAt: input.plannedStartAt === undefined ? before.plannedStartAt : input.plannedStartAt,
        plannedEndAt: input.plannedEndAt === undefined ? before.plannedEndAt : input.plannedEndAt,
        technicalNotes:
          input.technicalNotes === undefined ? before.technicalNotes : input.technicalNotes?.trim() || null,
        printStatus: input.printStatus ?? before.printStatus,
      },
    });

    await recordAudit(
      {
        entityType: "production_order",
        entityId: orderId,
        action: "production_order.update",
        before: { printStatus: before.printStatus, printerId: before.printerId },
        after: { printStatus: after.printStatus, printerId: after.printerId },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

// --- conclusão da produção (PROD-3) --------------------------------------------

export type FilamentActualInput = {
  filamentId: string;
  actualGrams: Prisma.Decimal.Value;
};

export type CompleteProductionInput = {
  actualHours: Prisma.Decimal.Value;
  filamentActuals: FilamentActualInput[];
  technicalNotes?: string | null;
};

/**
 * Conclui a produção (PROD-3): aponta horas reais e, quando a ordem tem um
 * Job vinculado, converte a reserva de cada filamento em consumo real — as
 * gramas reais podem ser diferentes da estimativa (`JobFilament.gramsUsed`):
 * se MAIOR, valida e consome a diferença adicional (nova movimentação
 * RESERVA, que falha se não houver saldo — caso crítico PROD-5); se MENOR,
 * libera a diferença de volta ao saldo disponível (LIBERACAO_RESERVA). Tudo
 * em uma única transação — se qualquer filamento não tiver saldo para o
 * consumo adicional, NADA é aplicado (a ordem continua como estava, não é
 * marcada como concluída) — mesmo espírito do caso crítico "Editar job já
 * com estoque reservado" da Etapa 2 §05.
 *
 * Quando a ordem NÃO tem Job vinculado (criada manualmente para uma versão
 * de orçamento manual), não há `JobFilament` para reconciliar — o estoque
 * dessa ordem, se usado, é gerenciado manualmente em `/estoque`. Nesse caso
 * `filamentActuals` deve vir vazio; um valor não vazio é rejeitado para não
 * silenciosamente ignorar dados que o usuário esperava que fossem aplicados.
 */
export async function completeProduction(
  orderId: string,
  input: CompleteProductionInput,
  actorUserId: string,
): Promise<ProductionOrder> {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { job: { include: { jobFilaments: true } } },
  });
  if (!order) throw new BusinessRuleError("Ordem de produção não encontrada.");
  if (order.printStatus === "CONCLUIDA") {
    throw new BusinessRuleError("Esta ordem de produção já foi concluída.");
  }

  const actualHours = toDecimal(input.actualHours, "horas reais");
  if (actualHours.lessThanOrEqualTo(0)) {
    throw new BusinessRuleError("As horas reais de impressão devem ser maiores que zero.");
  }

  if (!order.jobId) {
    if (input.filamentActuals.length > 0) {
      throw new BusinessRuleError(
        "Esta ordem de produção não tem job vinculado — não há reserva de filamento para reconciliar. " +
          "Gerencie o estoque manualmente em /estoque.",
      );
    }
  } else {
    const jobFilaments = order.job?.jobFilaments ?? [];
    const expectedIds = new Set(jobFilaments.map((jf) => jf.filamentId));
    const providedIds = new Set(input.filamentActuals.map((f) => f.filamentId));
    const sameSize = expectedIds.size === providedIds.size;
    const sameMembers = sameSize && [...expectedIds].every((id) => providedIds.has(id));
    if (!sameMembers) {
      throw new BusinessRuleError(
        "Informe as gramas reais de todos os filamentos do job — nem a mais, nem a menos.",
      );
    }
  }

  const technicalNotes = input.technicalNotes?.trim() || null;

  const updated = await prisma.$transaction(async (tx) => {
    if (order.jobId) {
      const jobFilaments = order.job?.jobFilaments ?? [];
      const actualByFilament = new Map(
        input.filamentActuals.map((f) => [f.filamentId, toDecimal(f.actualGrams, "gramas reais")]),
      );

      for (const jf of jobFilaments) {
        const actualGrams = actualByFilament.get(jf.filamentId);
        if (actualGrams === undefined) {
          throw new BusinessRuleError("Informe as gramas reais de todos os filamentos do job.");
        }
        if (actualGrams.lessThan(0)) {
          throw new BusinessRuleError("As gramas reais não podem ser negativas.");
        }

        const diff = actualGrams.minus(jf.gramsUsed);

        if (diff.greaterThan(0)) {
          try {
            await recordMovementInTx(
              tx,
              {
                filamentId: jf.filamentId,
                type: "RESERVA",
                quantityGrams: diff,
                reason: `Consumo adicional na conclusão da produção (ordem ${orderId}) — gramas reais maiores que o reservado.`,
                productionOrderId: orderId,
              },
              actorUserId,
            );
          } catch (err) {
            if (err instanceof FilamentBusinessRuleError) throw new BusinessRuleError(err.message);
            throw err;
          }
        } else if (diff.lessThan(0)) {
          await recordMovementInTx(
            tx,
            {
              filamentId: jf.filamentId,
              type: "LIBERACAO_RESERVA",
              quantityGrams: diff.negated(),
              reason: `Liberação — gramas reais menores que o reservado (ordem ${orderId}).`,
              productionOrderId: orderId,
            },
            actorUserId,
          );
        }

        await tx.jobFilament.update({ where: { id: jf.id }, data: { gramsActual: actualGrams } });
      }
    }

    const after = await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        actualHours,
        technicalNotes: technicalNotes ?? order.technicalNotes,
        printStatus: "CONCLUIDA",
        completedAt: new Date(),
      },
    });

    await recordAudit(
      {
        entityType: "production_order",
        entityId: orderId,
        action: "production_order.complete",
        before: { printStatus: order.printStatus },
        after: { printStatus: "CONCLUIDA", actualHours: actualHours.toString() },
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
 * Checa se a `ProductionOrder` mais recente vinculada à oportunidade está
 * CONCLUIDA — usado por src/modules/crm/services/opportunities.ts
 * (`moveStage`) para popular a pré-condição real de Desenvolvimento →
 * Qualidade (PROD-3, seção 09 da Etapa 1).
 *
 * Checa a MAIS RECENTE, não "existe alguma concluída alguma vez" (mudança do
 * Sprint 7 — módulo `quality`): a partir de uma reprovação de qualidade, uma
 * oportunidade pode ter mais de uma ProductionOrder ao longo do tempo (a
 * original + uma por ciclo de retrabalho,
 * src/modules/quality/services/quality.ts, `submitQualityCheck`). Se a
 * checagem aceitasse qualquer ordem concluída no passado, uma oportunidade
 * voltada para Desenvolvimento por reprovação (com o retrabalho ainda
 * AGUARDANDO) poderia avançar de novo para Qualidade usando a ordem original
 * já concluída — pulando a conclusão do retrabalho de verdade.
 */
export async function hasCompletedProductionOrder(opportunityId: string): Promise<boolean> {
  const latest = await prisma.productionOrder.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    select: { printStatus: true },
  });
  return latest?.printStatus === "CONCLUIDA";
}

export async function listPrinters() {
  return prisma.printer.findMany({ orderBy: { name: "asc" } });
}

/**
 * Ordem de produção mais recente da oportunidade (normalmente a única — ver
 * comentário em `ProductionOrder` no schema), com os dados de apoio da
 * página de detalhe (/crm/[id]): impressora, responsável, e — quando há Job
 * — os filamentos estimados/reais para o painel de conclusão.
 */
export async function getProductionOrderByOpportunity(opportunityId: string) {
  return prisma.productionOrder.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    include: {
      printer: { select: { id: true, name: true, status: true } },
      responsible: { select: { id: true, name: true } },
      job: {
        include: {
          jobFilaments: {
            include: { filament: { select: { id: true, name: true, material: true, color: true } } },
          },
        },
      },
    },
  });
}
