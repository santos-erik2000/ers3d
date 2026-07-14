import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { NEXT_STAGE, STAGE_LABEL } from "@/modules/crm/format";
import { getOrCreateOpenCycle } from "@/modules/crm/services/cycles";
import { hasCompletedProductionOrder } from "@/modules/production/services/production";
import { hasApprovedQualityCheck } from "@/modules/quality/services/quality";
import { Prisma, type Opportunity, type OpportunityPriority, type OpportunityStage } from "@prisma/client";

export class BusinessRuleError extends Error {}

// --- fluxo e transições (Sprint 3 — épico E3, CRM-1/CRM-2) -----------------
//
// Fonte: planejamento/01-visao-arquitetura.html seção 08 (fluxo) e seção 09
// (pré-condições). planejamento/02-personas-jornadas-historias.html seção 06
// define quem pode mover cada transição por perfil — como os perfis
// "Comercial" e "Técnico" ainda não existem (só ROOT/Administrador/Contador),
// a checagem de acesso aqui é a permissão única `crm.manage` (ver TODO em
// src/modules/auth/services/permissions.ts). Quando esses perfis existirem, a
// granularidade por transição/perfil entra como checagem adicional dentro de
// `moveStage`, não como reescrita deste módulo.
//
// STAGE_LABEL e NEXT_STAGE (etapa seguinte no fluxo padrão) vivem em
// src/modules/crm/format.ts — fonte única, reaproveitada aqui e pela UI.

type TransitionSubject = {
  value: Prisma.Decimal;
  deadlineAt: Date | null;
  // Sprint 5 (módulo quotes): calculado pelo chamador (moveStage) a partir de
  // `hasApprovedQuoteVersion` — existe alguma QuoteVersion com status
  // APPROVED vinculada à oportunidade? Opcional/undefined nas transições que
  // não dependem disso (só o case NEGOCIACAO usa este campo), para não
  // obrigar toda chamada de validateTransition (inclusive nos testes puros
  // que não passam por moveStage) a sempre informar.
  hasApprovedQuote?: boolean;
  // Sprint 6 (módulo production): calculado pelo chamador (moveStage) a
  // partir de `hasCompletedProductionOrder` — existe alguma ProductionOrder
  // com status CONCLUIDA vinculada à oportunidade? Só relevante no case
  // DESENVOLVIMENTO, mesmo padrão de `hasApprovedQuote` acima.
  hasCompletedProduction?: boolean;
  // Sprint 7 (módulo quality): calculado pelo chamador (moveStage) a partir
  // de `hasApprovedQualityCheck` — o QualityCheck mais recente da
  // oportunidade tem result = APROVADO ou APROVADO_COM_RESSALVA? Só relevante
  // no case QUALIDADE, mesmo padrão de `hasApprovedQuote`/
  // `hasCompletedProduction` acima.
  hasQualityApproval?: boolean;
};

/**
 * Valida se `fromStage -> toStage` é um caminho que existe no fluxo do
 * Kanban e, se existir, se as pré-condições checáveis hoje são cumpridas.
 * Lança BusinessRuleError com mensagem clara em qualquer caso de rejeição —
 * este é o caso crítico explícito da Etapa 2, seção 05 ("nenhum card pula
 * etapa nem anda por um caminho que não existe, ex. Proposta → Entrega").
 *
 * Pré-condições que dependem de módulos futuros (orçamento, produção,
 * qualidade, entrega, financeiro — Sprints 5 a 9) são deliberadamente NÃO
 * simuladas aqui: são documentadas como TODO inline e não bloqueiam a
 * transição, para não inventar uma regra falsa nem travar o fluxo à toa.
 */
export function validateTransition(
  fromStage: OpportunityStage,
  toStage: OpportunityStage,
  subject: TransitionSubject,
  note?: string | null,
): void {
  if (fromStage === toStage) {
    throw new BusinessRuleError("A oportunidade já está nessa etapa.");
  }

  const isForwardStep = NEXT_STAGE[fromStage] === toStage;
  const isQualityRejection = fromStage === "QUALIDADE" && toStage === "DESENVOLVIMENTO";

  if (!isForwardStep && !isQualityRejection) {
    throw new BusinessRuleError(
      `Movimentação inválida: não existe transição direta de "${STAGE_LABEL[fromStage]}" para "${STAGE_LABEL[toStage]}" no fluxo do Kanban.`,
    );
  }

  // Reprovação de qualidade → volta para Desenvolvimento (seção 09: "Motivo
  // obrigatório"). É a única pré-condição real e checável hoje — o resto do
  // fluxo de retrabalho (novo ciclo de produção) é Sprint 7 (módulo quality).
  if (isQualityRejection) {
    if (!note || !note.trim()) {
      throw new BusinessRuleError(
        "Informe o motivo da reprovação antes de devolver o card para Desenvolvimento.",
      );
    }
    return;
  }

  switch (fromStage) {
    case "PROPOSTA":
      // Pré-condição (seção 09): "Cliente cadastrado + oportunidade + orçamento
      // (calculadora ou manual justificado)". Cliente + oportunidade já são
      // garantidos pela própria existência do registro (FK obrigatória).
      // TODO (Sprint 5 — módulo quotes): quando `quotes`/`quote_versions`
      // existir, exigir aqui um orçamento (formal ou manual justificado)
      // vinculado à oportunidade antes de liberar Proposta → Negociação.
      break;

    case "NEGOCIACAO":
      // Pré-condição (seção 09): "Orçamento aprovado, valor negociado,
      // condição de pagamento e prazo definidos". Valor/prazo continuam
      // sendo os campos manuais do card (Sprint 3) — "orçamento aprovado"
      // agora é checado de verdade (Sprint 5 — módulo quotes):
      // `subject.hasApprovedQuote` é calculado por `moveStage` a partir de
      // `hasApprovedQuoteVersion` (existe uma QuoteVersion com
      // status = APPROVED vinculada à oportunidade?). "Condição de
      // pagamento" fica registrada na própria QuoteVersion aprovada
      // (`paymentTerms`), não é checada como campo isolado aqui — checar sua
      // presença é um refinamento possível, não um bloqueio inventado.
      if (!subject.value || subject.value.lessThanOrEqualTo(0)) {
        throw new BusinessRuleError(
          "Defina o valor negociado (maior que zero) antes de mover para Desenvolvimento.",
        );
      }
      if (!subject.deadlineAt) {
        throw new BusinessRuleError("Defina o prazo antes de mover para Desenvolvimento.");
      }
      if (!subject.hasApprovedQuote) {
        throw new BusinessRuleError(
          "É necessário ter uma versão de orçamento aprovada (quotes) antes de mover para Desenvolvimento.",
        );
      }
      break;

    case "DESENVOLVIMENTO":
      // Pré-condição (seção 09): "status de impressão = concluída; horas e
      // material reais preenchidos". Conectada de verdade a partir do
      // Sprint 6 (módulo production): existe uma ProductionOrder com status
      // CONCLUIDA vinculada à oportunidade
      // (src/modules/production/services/production.ts,
      // `hasCompletedProductionOrder`) — `completeProduction` só chega nesse
      // status depois de apontar horas reais e reconciliar as gramas reais
      // de cada filamento do job. Cobre tanto a ordem criada automaticamente
      // (versão de orçamento com job) quanto a manual (versão sem job).
      if (!subject.hasCompletedProduction) {
        throw new BusinessRuleError(
          "É necessário que a ordem de produção desta oportunidade esteja com status Concluída antes de mover para Teste de Qualidade.",
        );
      }
      break;

    case "QUALIDADE":
      // Pré-condição (seção 09): "resultado = aprovado ou aprovado com
      // ressalva". Conectada de verdade a partir do Sprint 7 (módulo
      // quality): existe um QualityCheck mais recente com esse resultado
      // vinculado à oportunidade
      // (src/modules/quality/services/quality.ts, `hasApprovedQualityCheck`).
      // A reprovação (result = REPROVADO) não passa por este caminho — ela é
      // a própria transição inversa QUALIDADE → DESENVOLVIMENTO, tratada
      // pelo `isQualityRejection` acima (motivo obrigatório) e disparada por
      // `submitQualityCheck`, não por uma chamada solta a `moveStage`.
      if (!subject.hasQualityApproval) {
        throw new BusinessRuleError(
          "É necessário que o checklist de qualidade mais recente tenha resultado aprovado ou aprovado com ressalva antes de mover para Entrega.",
        );
      }
      break;

    case "ENTREGA":
      // TODO (Sprints 7/8/9 — qualidade, entrega, financeiro): pré-condição
      // real é "qualidade aprovada + produção finalizada + entrega
      // registrada + pendências financeiras justificadas". Nenhum desses
      // módulos existe ainda — nenhuma checagem adicional é feita hoje.
      break;

    default:
      break;
  }
}

// --- tipos de entrada --------------------------------------------------------

export type OpportunityInput = {
  title: string;
  customerId: string;
  value?: number | string | null;
  ownerId?: string | null;
  deadlineAt?: Date | null;
  priority?: OpportunityPriority;
  tags?: string[];
};

export type OpportunityFilters = {
  ownerId?: string;
  customerId?: string;
  priority?: OpportunityPriority;
  overdueOnly?: boolean;
};

// --- operações ----------------------------------------------------------------

export async function createOpportunity(
  input: OpportunityInput,
  actorUserId: string,
): Promise<Opportunity> {
  const title = input.title.trim();
  if (!title) throw new BusinessRuleError("Informe o nome do projeto/oportunidade.");
  if (!input.customerId) throw new BusinessRuleError("Selecione um cliente.");

  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(input.value ?? 0);
  } catch {
    throw new BusinessRuleError("Valor negociado inválido.");
  }
  if (value.lessThan(0)) throw new BusinessRuleError("O valor negociado não pode ser negativo.");

  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  const created = await prisma.$transaction(async (tx) => {
    // Sprint 5 (CRM-5): toda oportunidade nasce vinculada ao ciclo mensal
    // aberto atual — cria automaticamente o primeiro ciclo (mês corrente) se
    // nenhum existir ainda, para não exigir um passo manual de setup.
    const cycle = await getOrCreateOpenCycle(tx);

    const opportunity = await tx.opportunity.create({
      data: {
        title,
        customerId: input.customerId,
        value,
        ownerId: input.ownerId || null,
        deadlineAt: input.deadlineAt ?? null,
        priority: input.priority ?? "MEDIUM",
        tags,
        cycleId: cycle.id,
      },
    });

    // Entrada inicial no histórico — fromStage nulo marca a criação (CRM-3
    // usa isto como base do "dias na etapa" desde o primeiro momento).
    await tx.opportunityStageHistory.create({
      data: {
        opportunityId: opportunity.id,
        fromStage: null,
        toStage: "PROPOSTA",
        userId: actorUserId,
      },
    });

    await recordAudit(
      {
        entityType: "opportunity",
        entityId: opportunity.id,
        action: "opportunity.create",
        after: {
          title,
          customerId: input.customerId,
          value: value.toString(),
          priority: opportunity.priority,
          deadlineAt: opportunity.deadlineAt,
        },
        userId: actorUserId,
      },
      tx,
    );

    return opportunity;
  });

  return created;
}

export async function moveStage(
  opportunityId: string,
  toStage: OpportunityStage,
  actorUserId: string,
  note?: string | null,
): Promise<Opportunity> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");

  // Sprint 5: a checagem de "orçamento aprovado" (case NEGOCIACAO de
  // validateTransition) só é relevante quando a oportunidade está saindo de
  // Negociação — evita uma consulta desnecessária nas demais transições.
  let hasApprovedQuote: boolean | undefined;
  if (opportunity.stage === "NEGOCIACAO") {
    const approvedVersion = await prisma.quoteVersion.findFirst({
      where: { status: "APPROVED", quote: { opportunityId } },
      select: { id: true },
    });
    hasApprovedQuote = Boolean(approvedVersion);
  }

  // Sprint 6: mesmo padrão acima — só consulta ProductionOrder quando a
  // oportunidade está saindo de Desenvolvimento (case DESENVOLVIMENTO de
  // validateTransition).
  let hasCompletedProduction: boolean | undefined;
  if (opportunity.stage === "DESENVOLVIMENTO") {
    hasCompletedProduction = await hasCompletedProductionOrder(opportunityId);
  }

  // Sprint 7: mesmo padrão acima — só consulta QualityCheck quando a
  // oportunidade está saindo de Qualidade (case QUALIDADE de
  // validateTransition). A transição inversa (reprovação, QUALIDADE →
  // DESENVOLVIMENTO) não usa este campo — ela é decidida pelo motivo
  // obrigatório do `isQualityRejection`, calculado antes do switch.
  let hasQualityApproval: boolean | undefined;
  if (opportunity.stage === "QUALIDADE" && toStage !== "DESENVOLVIMENTO") {
    hasQualityApproval = await hasApprovedQualityCheck(opportunityId);
  }

  validateTransition(
    opportunity.stage,
    toStage,
    { ...opportunity, hasApprovedQuote, hasCompletedProduction, hasQualityApproval },
    note,
  );

  const trimmedNote = note?.trim() || null;

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.opportunity.update({
      where: { id: opportunityId },
      data: { stage: toStage },
    });

    await tx.opportunityStageHistory.create({
      data: {
        opportunityId,
        fromStage: opportunity.stage,
        toStage,
        note: trimmedNote,
        userId: actorUserId,
      },
    });

    await recordAudit(
      {
        entityType: "opportunity",
        entityId: opportunityId,
        action: "opportunity.stage.move",
        before: { stage: opportunity.stage },
        after: { stage: toStage },
        reason: trimmedNote ?? undefined,
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

/**
 * Oportunidade com os dados de apoio da página de detalhe (Sprint 5 —
 * /crm/[id]): cliente, responsável, ciclo atual e, se houver, o ciclo de
 * onde foi "carregada" como pendência (ver src/modules/crm/services/cycles.ts).
 */
export async function getOpportunityById(id: string) {
  return prisma.opportunity.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      cycle: { select: { id: true, referenceMonth: true, status: true } },
      carriedFromCycle: { select: { id: true, referenceMonth: true } },
    },
  });
}

export async function listOpportunities(filters: OpportunityFilters = {}) {
  const where: Prisma.OpportunityWhereInput = {};
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.priority) where.priority = filters.priority;
  if (filters.overdueOnly) {
    where.deadlineAt = { lt: new Date() };
    where.stage = { not: "CONCLUIDO" };
  }

  return prisma.opportunity.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      stageHistory: { orderBy: { movedAt: "desc" }, take: 1 },
    },
  });
}
