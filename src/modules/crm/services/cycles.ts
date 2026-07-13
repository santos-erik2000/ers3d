// Ciclo mensal do Kanban CRM (Sprint 5 — épico E3, história CRM-5). Fonte:
// planejamento/01-visao-arquitetura.html §05 (risco técnico "Modelagem de
// ciclo mensal") e §08/§11; planejamento/02-personas-jornadas-historias.html
// §03 ("Fechamento de ciclo mensal") e §05 (caso crítico "Fechamento mensal
// com cards abertos").
//
// Regra central: fechar um ciclo NUNCA é destrutivo. Nenhum card desaparece,
// nenhuma linha de Opportunity é duplicada por ciclo (a mesma linha só muda
// de `cycleId` — o histórico completo de etapa continua em
// `OpportunityStageHistory`, que não é tocado aqui). Toda oportunidade ainda
// aberta (stage != CONCLUIDO) no ciclo sendo fechado exige uma decisão
// explícita e individual: "TRANSPORT" (segue no novo ciclo, sem marcação
// especial) ou "CARRY_AS_PENDING" (segue no novo ciclo, mas marcada via
// `carriedFromCycleId` como uma pendência carregada do ciclo anterior, para a
// UI deixar isso visualmente claro — nunca só um card "sumindo"). Cards já
// CONCLUIDO permanecem arquivados no ciclo fechado, sem decisão necessária.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { Prisma, type CrmCycle } from "@prisma/client";

export class BusinessRuleError extends Error {}

export type CycleClosureDecisionType = "TRANSPORT" | "CARRY_AS_PENDING";

export type CycleClosureDecision = {
  opportunityId: string;
  decision: CycleClosureDecisionType;
};

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

/**
 * Ciclo aberto atual, se houver — não cria nada (uso em leitura, ex. tela do
 * Kanban mostrando "ciclo vigente").
 */
export async function getOpenCycle(
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CrmCycle | null> {
  return tx.crmCycle.findFirst({ where: { status: "OPEN" }, orderBy: { referenceMonth: "desc" } });
}

/**
 * Ciclo aberto atual — cria automaticamente o primeiro ciclo (mês corrente,
 * UTC) se nenhum existir ainda. Chamado por
 * src/modules/crm/services/opportunities.ts (createOpportunity) para que toda
 * oportunidade nova já nasça vinculada a um ciclo, sem exigir um passo manual
 * de "abrir o primeiro ciclo" antes de usar o sistema.
 */
export async function getOrCreateOpenCycle(
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CrmCycle> {
  const existing = await getOpenCycle(tx);
  if (existing) return existing;
  return tx.crmCycle.create({ data: { referenceMonth: startOfMonthUTC(new Date()), status: "OPEN" } });
}

export async function listCycles(): Promise<CrmCycle[]> {
  return prisma.crmCycle.findMany({ orderBy: { referenceMonth: "desc" } });
}

/**
 * Cards ainda em aberto (stage != CONCLUIDO) de um ciclo — a lista que a
 * tela de fechamento precisa exibir para coletar a decisão de cada um antes
 * de permitir concluir o fechamento (CRM-5).
 */
export async function getOpenCardsForCycle(cycleId: string) {
  return prisma.opportunity.findMany({
    where: { cycleId, stage: { not: "CONCLUIDO" } },
    orderBy: { createdAt: "asc" },
    include: { customer: { select: { id: true, name: true } } },
  });
}

/**
 * Fecha um ciclo mensal. Exige uma decisão explícita para CADA oportunidade
 * ainda aberta do ciclo — nem uma a mais, nem uma a menos — e rejeita o
 * fechamento inteiro (nada é aplicado) se a lista não bater exatamente com
 * os cards em aberto. Este é o caso crítico explícito da Etapa 2, seção 05
 * ("Fechamento mensal com cards abertos"): "o sistema exige uma decisão
 * explícita por card [...] antes de permitir concluir o fechamento — nenhum
 * card desaparece silenciosamente".
 */
export async function closeCycle(
  cycleId: string,
  decisions: CycleClosureDecision[],
  actorUserId: string,
): Promise<CrmCycle> {
  const cycle = await prisma.crmCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new BusinessRuleError("Ciclo não encontrado.");
  if (cycle.status !== "OPEN") throw new BusinessRuleError("Este ciclo já está fechado.");

  const openOpportunities = await prisma.opportunity.findMany({
    where: { cycleId, stage: { not: "CONCLUIDO" } },
    select: { id: true },
  });
  const openIds = new Set(openOpportunities.map((o) => o.id));

  const decisionByOpportunity = new Map<string, CycleClosureDecisionType>();
  for (const d of decisions) {
    decisionByOpportunity.set(d.opportunityId, d.decision);
  }

  if (decisionByOpportunity.size !== openIds.size) {
    throw new BusinessRuleError(
      "É preciso decidir (transportar ou manter como pendência carregada) sobre todos os cards em aberto deste ciclo antes de fechar — nenhum card pode ficar sem decisão.",
    );
  }
  for (const id of openIds) {
    if (!decisionByOpportunity.has(id)) {
      throw new BusinessRuleError(
        "É preciso decidir (transportar ou manter como pendência carregada) sobre todos os cards em aberto deste ciclo antes de fechar — nenhum card pode ficar sem decisão.",
      );
    }
  }
  for (const opportunityId of decisionByOpportunity.keys()) {
    if (!openIds.has(opportunityId)) {
      throw new BusinessRuleError(
        "Uma das oportunidades informadas não pertence aos cards em aberto deste ciclo.",
      );
    }
  }

  const nextReferenceMonth = addMonthsUTC(cycle.referenceMonth, 1);

  const closed = await prisma.$transaction(async (tx) => {
    let newCycle = await tx.crmCycle.findFirst({ where: { referenceMonth: nextReferenceMonth } });
    if (!newCycle) {
      newCycle = await tx.crmCycle.create({ data: { referenceMonth: nextReferenceMonth, status: "OPEN" } });
    }

    for (const [opportunityId, decision] of decisionByOpportunity) {
      const carriedFromCycleId = decision === "CARRY_AS_PENDING" ? cycleId : null;
      await tx.opportunity.update({
        where: { id: opportunityId },
        data: { cycleId: newCycle.id, carriedFromCycleId },
      });

      await recordAudit(
        {
          entityType: "opportunity",
          entityId: opportunityId,
          action: "opportunity.cycle.carry",
          before: { cycleId },
          after: { cycleId: newCycle.id, carriedFromCycleId },
          reason: decision,
          userId: actorUserId,
        },
        tx,
      );
    }

    const after = await tx.crmCycle.update({
      where: { id: cycleId },
      data: { status: "CLOSED", closedAt: new Date(), closedById: actorUserId },
    });

    await recordAudit(
      {
        entityType: "crm_cycle",
        entityId: cycleId,
        action: "crm_cycle.close",
        before: { status: "OPEN" },
        after: {
          status: "CLOSED",
          decisionsCount: decisions.length,
          newCycleId: newCycle.id,
        },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return closed;
}
