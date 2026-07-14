import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { NEXT_STAGE, STAGE_LABEL } from "@/modules/crm/format";
import { getOrCreateOpenCycle } from "@/modules/crm/services/cycles";
import { hasDeliveredDelivery } from "@/modules/deliveries/services/deliveries";
import { getAccountsReceivableStatusForOpportunity } from "@/modules/finance/services/receivables";
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
  // oportunidade tem result = APROVADO ou APROVADO_COM_RESSALVA? Relevante no
  // case QUALIDADE (Qualidade → Entrega) e, a partir do Sprint 8, também
  // recalculado no case ENTREGA (Entrega → Concluído exige qualidade
  // aprovada de novo — ver comentário nesse case), mesmo padrão de
  // `hasApprovedQuote`/`hasCompletedProduction` acima.
  hasQualityApproval?: boolean;
  // Sprint 8 (módulo deliveries): calculado pelo chamador (moveStage) a
  // partir de `hasDeliveredDelivery` — existe uma Delivery mais recente com
  // status ENTREGUE vinculada à oportunidade? Só relevante no case ENTREGA.
  hasDelivered?: boolean;
  // Sprint 9 (módulo finance): calculados pelo chamador (moveStage) a partir
  // de `getAccountsReceivableStatusForOpportunity` — existe uma
  // AccountsReceivable para a oportunidade (situação financeira conhecida —
  // FIN-1/DEL-2) e, se existir, ela está com status PAGO? Só relevantes no
  // case ENTREGA. "Situação financeira conhecida" exige só a EXISTÊNCIA do
  // registro (nasce sempre na aprovação do orçamento, ver
  // src/modules/quotes/services/quotes.ts, `approveVersion`) — não exige
  // estar paga: inadimplência nunca bloqueia a conclusão, só precisa ficar
  // documentada (ver `note` obrigatório abaixo quando não está PAGO).
  hasAccountsReceivable?: boolean;
  isAccountsReceivablePaid?: boolean;
};

/**
 * Valida se `fromStage -> toStage` é um caminho que existe no fluxo do
 * Kanban e, se existir, se as pré-condições checáveis hoje são cumpridas.
 * Lança BusinessRuleError com mensagem clara em qualquer caso de rejeição —
 * este é o caso crítico explícito da Etapa 2, seção 05 ("nenhum card pula
 * etapa nem anda por um caminho que não existe, ex. Proposta → Entrega").
 *
 * Pré-condições que dependiam de módulos futuros (orçamento, produção,
 * qualidade, entrega, financeiro — Sprints 5 a 9) foram conectadas de
 * verdade conforme cada módulo nasceu; a partir do Sprint 9 (finance) as
 * quatro partes checáveis da pré-condição de Entrega → Concluído (seção 09)
 * já são reais. Enquanto um módulo ainda não existia, sua parte ficava
 * documentada como TODO inline em vez de simular uma checagem falsa — mesmo
 * princípio se algum módulo de expansão futuro (fora do MVP) vier a existir.
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
      // Pré-condição (seção 09): "qualidade aprovada + produção finalizada +
      // entrega registrada + pendências financeiras justificadas". Esta é a
      // ÚNICA transição real que sai da etapa Entrega neste fluxo (fromStage
      // = ENTREGA, toStage = CONCLUIDO — ver NEXT_STAGE em
      // src/modules/crm/format.ts), então é aqui — sob o desenho
      // switch(fromStage) já usado em todo este arquivo — que a checagem de
      // verdade acontece, não no `case "CONCLUIDO"` abaixo (que existe só por
      // completude, ver seu comentário).
      //
      // A partir do Sprint 8 (módulos inventory/deliveries) e do Sprint 9
      // (módulo finance), as quatro partes da pré-condição da seção 09 são
      // conectadas de verdade: `hasCompletedProduction` e
      // `hasQualityApproval` são RECALCULADAS aqui (não reaproveitadas dos
      // cases DESENVOLVIMENTO/QUALIDADE acima, que só valem para a transição
      // imediatamente seguinte à etapa em que cada uma vive), `hasDelivered`
      // é do Sprint 8 (`hasDeliveredDelivery`, módulo `deliveries`) e
      // `hasAccountsReceivable`/`isAccountsReceivablePaid` são do Sprint 9
      // (`getAccountsReceivableStatusForOpportunity`, módulo `finance`).
      if (!subject.hasCompletedProduction) {
        throw new BusinessRuleError(
          "É necessário que a produção desta oportunidade esteja concluída antes de mover para Concluído.",
        );
      }
      if (!subject.hasQualityApproval) {
        throw new BusinessRuleError(
          "É necessário que o checklist de qualidade mais recente esteja aprovado ou aprovado com ressalva antes de mover para Concluído.",
        );
      }
      if (!subject.hasDelivered) {
        throw new BusinessRuleError(
          "É necessário que a entrega desta oportunidade esteja registrada com status Entregue antes de mover para Concluído.",
        );
      }
      // "Situação financeira conhecida" (Sprint 9, FIN-1/DEL-2) exige que
      // EXISTA uma AccountsReceivable — nasce sempre na aprovação do
      // orçamento (`approveVersion`), então na prática só falta quando a
      // oportunidade nunca teve orçamento aprovado, o que já teria barrado
      // uma transição anterior. Não exige estar PAGA: inadimplência nunca
      // bloqueia a conclusão (decisão explícita do briefing original) — só
      // exige que a pendência fique DOCUMENTADA via observação obrigatória
      // (mesma ideia de nota obrigatória condicional já usada na reprovação
      // de qualidade, `isQualityRejection` acima).
      if (!subject.hasAccountsReceivable) {
        throw new BusinessRuleError(
          "É necessário que exista uma conta a receber (situação financeira conhecida) antes de mover para Concluído.",
        );
      }
      if (!subject.isAccountsReceivablePaid && (!note || !note.trim())) {
        throw new BusinessRuleError(
          "A conta a receber desta oportunidade ainda não está paga — informe uma observação justificando a pendência antes de mover para Concluído.",
        );
      }
      break;

    case "CONCLUIDO":
      // Adicionado por completude do switch(fromStage) — nunca executa na
      // prática: CONCLUIDO é o estágio terminal deste fluxo
      // (NEXT_STAGE["CONCLUIDO"] = null, src/modules/crm/format.ts), então
      // nenhuma transição válida parte daqui (qualquer tentativa já é
      // rejeitada mais acima, pelo guard `!isForwardStep && !isQualityRejection`,
      // antes mesmo de chegar neste switch). A pré-condição real de "Entrega
      // → Concluído" vive no `case "ENTREGA"` acima, que é o que de fato
      // governa essa transição.
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
  // oportunidade está saindo de Desenvolvimento (case DESENVOLVIMENTO) OU
  // saindo de Entrega (case ENTREGA, Sprint 8 — a checagem de produção
  // concluída é reexigida na compound de Entrega → Concluído, não só na
  // transição imediatamente anterior).
  let hasCompletedProduction: boolean | undefined;
  if (opportunity.stage === "DESENVOLVIMENTO" || opportunity.stage === "ENTREGA") {
    hasCompletedProduction = await hasCompletedProductionOrder(opportunityId);
  }

  // Sprint 7: mesmo padrão acima — só consulta QualityCheck quando a
  // oportunidade está saindo de Qualidade (case QUALIDADE de
  // validateTransition, exceto a reprovação — decidida pelo motivo
  // obrigatório do `isQualityRejection`, não por este campo) OU saindo de
  // Entrega (case ENTREGA, Sprint 8 — mesma reexigência do parágrafo acima).
  let hasQualityApproval: boolean | undefined;
  if ((opportunity.stage === "QUALIDADE" && toStage !== "DESENVOLVIMENTO") || opportunity.stage === "ENTREGA") {
    hasQualityApproval = await hasApprovedQualityCheck(opportunityId);
  }

  // Sprint 8: só consulta Delivery quando a oportunidade está saindo de
  // Entrega (case ENTREGA — a única transição real que usa este campo).
  let hasDelivered: boolean | undefined;
  if (opportunity.stage === "ENTREGA") {
    hasDelivered = await hasDeliveredDelivery(opportunityId);
  }

  // Sprint 9: mesmo padrão acima — só consulta AccountsReceivable quando a
  // oportunidade está saindo de Entrega (case ENTREGA, a quarta parte da
  // pré-condição de Entrega → Concluído).
  let hasAccountsReceivable: boolean | undefined;
  let isAccountsReceivablePaid: boolean | undefined;
  if (opportunity.stage === "ENTREGA") {
    const arStatus = await getAccountsReceivableStatusForOpportunity(opportunityId);
    hasAccountsReceivable = arStatus.exists;
    isAccountsReceivablePaid = arStatus.isPaid;
  }

  validateTransition(
    opportunity.stage,
    toStage,
    {
      ...opportunity,
      hasApprovedQuote,
      hasCompletedProduction,
      hasQualityApproval,
      hasDelivered,
      hasAccountsReceivable,
      isAccountsReceivablePaid,
    },
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
