// Qualidade (Etapa 5, Sprint 7 — épico E6, histórias QUAL-1..QUAL-3). Ver o
// cabeçalho de `QualityCheck`/`QualityCheckItem` em prisma/schema.prisma para
// o desenho completo e a explicação de por que a escrita de reprovação
// (mover a oportunidade de volta para Desenvolvimento + abrir uma nova
// ProductionOrder de retrabalho) é feita DIRETAMENTE aqui, na mesma
// transação, em vez de chamar `moveStage`
// (src/modules/crm/services/opportunities.ts) ou
// `createManualProductionOrder`/`completeProduction`
// (src/modules/production/services/production.ts): `opportunities.ts` já
// depende deste módulo (`hasApprovedQualityCheck`, pré-condição real de
// Qualidade → Entrega) — importar de volta fecharia um ciclo entre módulos de
// serviço, o mesmo problema já resolvido entre `quotes` e `production` (ver
// comentário em `approveVersion`, src/modules/quotes/services/quotes.ts).

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import type { QualityCheck, QualityCheckResult } from "@prisma/client";

export class BusinessRuleError extends Error {}

const VALID_RESULTS: QualityCheckResult[] = ["APROVADO", "REPROVADO", "APROVADO_COM_RESSALVA"];

// --- tipos de entrada --------------------------------------------------------

export type QualityCheckItemInput = {
  label: string;
  passed: boolean;
  notes?: string | null;
  evidencePhotoUrl?: string | null;
};

export type SubmitQualityCheckInput = {
  opportunityId: string;
  productionOrderId: string;
  items: QualityCheckItemInput[];
  result: QualityCheckResult;
  // Obrigatório quando result = REPROVADO — validado abaixo, nunca imposto
  // pelo schema (o schema deixa a coluna nulável de propósito).
  rejectionReason?: string | null;
};

function normalizeItems(items: QualityCheckItemInput[]): QualityCheckItemInput[] {
  return items
    .map((item) => ({
      label: item.label.trim(),
      passed: Boolean(item.passed),
      notes: item.notes?.trim() || null,
      evidencePhotoUrl: item.evidencePhotoUrl?.trim() || null,
    }))
    .filter((item) => item.label.length > 0);
}

/**
 * Registra o resultado de um checklist de qualidade (QUAL-1) rodado contra
 * uma ProductionOrder já concluída, e — quando o resultado é REPROVADO — abre
 * o retrabalho na mesma transação (QUAL-2, caso crítico "Qualidade reprovada
 * gera retrabalho"):
 *
 *  1. move a Opportunity de volta para o stage DESENVOLVIMENTO, gravando a
 *     mesma entrada de OpportunityStageHistory + AuditLog que `moveStage`
 *     produziria para essa transição (fromStage QUALIDADE, toStage
 *     DESENVOLVIMENTO, note = motivo da reprovação);
 *  2. abre uma nova ProductionOrder (status AGUARDANDO) vinculada à mesma
 *     Opportunity e ao mesmo Job da ordem original (quando houver) — isso é
 *     o que permite `completeProduction` (módulo `production`, reaproveitado
 *     sem alteração nenhuma) reconciliar consumo adicional de material
 *     quando o retrabalho for concluído, exatamente como reconciliaria
 *     qualquer outra ordem com job vinculado.
 *
 * O QualityCheck (e seus itens) desta chamada NUNCA é apagado ou alterado
 * depois, mesmo que um retrabalho seguinte seja aprovado — é sempre possível
 * consultar reprovações antigas via `getQualityHistoryForOpportunity` (QUAL-3).
 *
 * Se o resultado for APROVADO ou APROVADO_COM_RESSALVA, só o registro em si é
 * gravado — nada mais é tocado (a pré-condição de Qualidade → Entrega passa a
 * enxergar isso via `hasApprovedQualityCheck`).
 */
export async function submitQualityCheck(
  input: SubmitQualityCheckInput,
  actorUserId: string,
): Promise<QualityCheck> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");
  if (opportunity.stage !== "QUALIDADE") {
    throw new BusinessRuleError(
      "Só é possível registrar um checklist de qualidade quando a oportunidade está na etapa Teste de Qualidade.",
    );
  }

  const productionOrder = await prisma.productionOrder.findUnique({ where: { id: input.productionOrderId } });
  if (!productionOrder) throw new BusinessRuleError("Ordem de produção não encontrada.");
  if (productionOrder.opportunityId !== input.opportunityId) {
    throw new BusinessRuleError("Esta ordem de produção não pertence a esta oportunidade.");
  }
  if (productionOrder.printStatus !== "CONCLUIDA") {
    throw new BusinessRuleError(
      "A ordem de produção precisa estar com status Concluída antes de rodar o checklist de qualidade.",
    );
  }

  if (!VALID_RESULTS.includes(input.result)) {
    throw new BusinessRuleError("Resultado do checklist inválido.");
  }

  const items = normalizeItems(input.items);
  if (items.length === 0) {
    throw new BusinessRuleError("Informe ao menos um item do checklist.");
  }

  const rejectionReason = input.rejectionReason?.trim() || null;
  if (input.result === "REPROVADO" && !rejectionReason) {
    throw new BusinessRuleError("Informe o motivo da reprovação.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const qualityCheck = await tx.qualityCheck.create({
      data: {
        opportunityId: input.opportunityId,
        productionOrderId: input.productionOrderId,
        result: input.result,
        rejectionReason: input.result === "REPROVADO" ? rejectionReason : null,
        checkedById: actorUserId,
        items: { create: items },
      },
    });

    await recordAudit(
      {
        entityType: "quality_check",
        entityId: qualityCheck.id,
        action: "quality_check.submit",
        after: {
          result: input.result,
          opportunityId: input.opportunityId,
          productionOrderId: input.productionOrderId,
        },
        reason: rejectionReason ?? undefined,
        userId: actorUserId,
      },
      tx,
    );

    if (input.result === "REPROVADO") {
      await tx.opportunity.update({
        where: { id: input.opportunityId },
        data: { stage: "DESENVOLVIMENTO" },
      });

      await tx.opportunityStageHistory.create({
        data: {
          opportunityId: input.opportunityId,
          fromStage: "QUALIDADE",
          toStage: "DESENVOLVIMENTO",
          note: rejectionReason,
          userId: actorUserId,
        },
      });

      await recordAudit(
        {
          entityType: "opportunity",
          entityId: input.opportunityId,
          action: "opportunity.stage.move",
          before: { stage: "QUALIDADE" },
          after: { stage: "DESENVOLVIMENTO" },
          reason: rejectionReason ?? undefined,
          userId: actorUserId,
        },
        tx,
      );

      const reworkOrder = await tx.productionOrder.create({
        data: {
          opportunityId: input.opportunityId,
          jobId: productionOrder.jobId,
          printStatus: "AGUARDANDO",
          technicalNotes: `Retrabalho — reprovação de qualidade (checklist ${qualityCheck.id}): ${rejectionReason}`,
        },
      });

      await recordAudit(
        {
          entityType: "production_order",
          entityId: reworkOrder.id,
          action: "production_order.create",
          after: {
            opportunityId: input.opportunityId,
            jobId: productionOrder.jobId,
            source: "quality_rework",
            sourceQualityCheckId: qualityCheck.id,
          },
          userId: actorUserId,
        },
        tx,
      );
    }

    return qualityCheck;
  });

  return created;
}

/**
 * Existe um QualityCheck mais recente para a oportunidade com
 * result = APROVADO ou APROVADO_COM_RESSALVA? Usado por
 * src/modules/crm/services/opportunities.ts (`moveStage`) para popular a
 * pré-condição real de Qualidade → Entrega — checa sempre o MAIS RECENTE
 * checklist (por `checkedAt`), nunca "existe algum aprovado alguma vez": uma
 * reprovação seguida de um novo checklist ainda não decidido não deve
 * liberar a transição usando uma aprovação antiga de um ciclo anterior.
 */
export async function hasApprovedQualityCheck(opportunityId: string): Promise<boolean> {
  const latest = await prisma.qualityCheck.findFirst({
    where: { opportunityId },
    orderBy: { checkedAt: "desc" },
    select: { result: true },
  });
  if (!latest) return false;
  return latest.result === "APROVADO" || latest.result === "APROVADO_COM_RESSALVA";
}

/**
 * Histórico completo de checklists de qualidade de uma oportunidade — mais
 * recentes primeiro, incluindo reprovações antigas (QUAL-3): nada aqui é
 * apagado nem some depois de um retrabalho seguinte ser aprovado.
 */
export async function getQualityHistoryForOpportunity(opportunityId: string) {
  return prisma.qualityCheck.findMany({
    where: { opportunityId },
    orderBy: { checkedAt: "desc" },
    include: {
      items: true,
      checkedBy: { select: { id: true, name: true } },
      productionOrder: { select: { id: true, printStatus: true } },
    },
  });
}
