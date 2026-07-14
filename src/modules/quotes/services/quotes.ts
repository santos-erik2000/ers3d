// Orçamento (Sprint 5 — épico E4, histórias CALC-4/CALC-5). Conecta um `Job`
// já calculado (src/modules/jobs/services/jobs.ts) a uma `Opportunity` do
// Kanban CRM, com versionamento — ou permite um orçamento manual com
// justificativa obrigatória (regra do briefing original).
//
// Regra crítica (planejamento/02-personas-jornadas-historias.html §05,
// "Alterar orçamento já aprovado" — caso crítico explícito CALC-4): NENHUMA
// função aqui atualiza os campos monetários de uma `QuoteVersion` já criada.
// "Editar" um orçamento é sempre criar uma NOVA `QuoteVersion` (número
// sequencial incrementado) — a versão aprovada anterior permanece intacta e
// consultável no histórico, nunca sobrescrita. `approveVersion`/
// `rejectVersion`/`sendVersion` só alteram o status/timestamps da própria
// versão que estão decidindo — nunca seus valores.
//
// Aprovar uma versão (`status: APPROVED`) é só o registro do orçamento
// aprovado — não move o card do Kanban, não mexe em estoque nem financeiro.
// A conexão real com a transição Negociação → Desenvolvimento vive em
// src/modules/crm/services/opportunities.ts (`validateTransition`), que
// checa a EXISTÊNCIA de uma QuoteVersion aprovada, sem chamar nada daqui.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError as FilamentBusinessRuleError,
  recordMovementInTx,
} from "@/modules/filaments/services/filaments";
import { Prisma, type Quote, type QuoteVersion } from "@prisma/client";

export class BusinessRuleError extends Error {}

function toDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  if (decimal.isNaN()) throw new Error("not a number");
  return decimal;
}

function normalizeQuantity(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 1;
  return Math.trunc(value);
}

async function getOrCreateQuote(tx: Prisma.TransactionClient, opportunityId: string): Promise<Quote> {
  const existing = await tx.quote.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return tx.quote.create({ data: { opportunityId, status: "DRAFT" } });
}

async function nextVersionNumber(tx: Prisma.TransactionClient, quoteId: string): Promise<number> {
  const last = await tx.quoteVersion.findFirst({
    where: { quoteId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (last?.versionNumber ?? 0) + 1;
}

// --- criação de versão --------------------------------------------------------

export type CommonVersionFields = {
  opportunityId: string;
  discount?: Prisma.Decimal.Value | null;
  paymentTerms?: string | null;
  deliveryDeadline?: Date | null;
  quantity?: number | null;
  notes?: string | null;
};

export type JobQuoteVersionInput = CommonVersionFields & {
  jobId: string;
};

export type ManualQuoteVersionInput = CommonVersionFields & {
  originalValue: Prisma.Decimal.Value;
  manualJustification: string;
};

/**
 * Gera uma nova versão de orçamento reaproveitando o preço já calculado de
 * um `Job` da calculadora (CALC-4). Se a oportunidade já tiver uma
 * `QuoteVersion` aprovada, isso não é tocado — apenas mais uma versão nasce
 * (número sequencial seguinte), a aprovada continua intacta.
 */
export async function createVersionFromJob(
  input: JobQuoteVersionInput,
  actorUserId: string,
): Promise<QuoteVersion> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");

  const job = await prisma.job.findUnique({ where: { id: input.jobId } });
  if (!job) throw new BusinessRuleError("Job de cálculo não encontrado.");

  let discount: Prisma.Decimal;
  try {
    discount = toDecimal(input.discount ?? 0);
  } catch {
    throw new BusinessRuleError("Desconto inválido.");
  }
  if (discount.lessThan(0)) throw new BusinessRuleError("O desconto não pode ser negativo.");

  const originalValue = job.finalPrice;
  const finalValue = originalValue.minus(discount);
  if (finalValue.lessThan(0)) {
    throw new BusinessRuleError("O desconto não pode ser maior do que o valor original do orçamento.");
  }

  const quantity = normalizeQuantity(input.quantity ?? job.quantityProduced);

  const created = await prisma.$transaction(async (tx) => {
    const quote = await getOrCreateQuote(tx, input.opportunityId);
    const versionNumber = await nextVersionNumber(tx, quote.id);

    const version = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber,
        jobId: job.id,
        isManual: false,
        manualJustification: null,
        originalValue,
        discount,
        finalValue,
        paymentTerms: input.paymentTerms?.trim() || null,
        deliveryDeadline: input.deliveryDeadline ?? null,
        quantity,
        notes: input.notes?.trim() || null,
        status: "DRAFT",
      },
    });

    // Uma nova versão nasce em DRAFT — "editar" um orçamento (mesmo um que já
    // tinha uma versão aprovada) nunca sobrescreve a decisão anterior, só
    // espelha no cabeçalho que agora há uma versão nova pendente de decisão.
    await tx.quote.update({ where: { id: quote.id }, data: { status: "DRAFT" } });

    await recordAudit(
      {
        entityType: "quote_version",
        entityId: version.id,
        action: "quote_version.create",
        after: {
          quoteId: quote.id,
          opportunityId: input.opportunityId,
          versionNumber,
          source: "job",
          jobId: job.id,
          originalValue: originalValue.toString(),
          discount: discount.toString(),
          finalValue: finalValue.toString(),
        },
        userId: actorUserId,
      },
      tx,
    );

    return version;
  });

  return created;
}

/**
 * Gera uma nova versão de orçamento manual — sem `Job` de origem. Exige
 * justificativa obrigatória (regra do briefing original: "orçamento manual
 * com justificativa"). Mesma garantia de versionamento: nunca sobrescreve
 * uma versão existente, sempre cria uma nova linha.
 */
export async function createManualVersion(
  input: ManualQuoteVersionInput,
  actorUserId: string,
): Promise<QuoteVersion> {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new BusinessRuleError("Oportunidade não encontrada.");

  const justification = input.manualJustification?.trim() ?? "";
  if (!justification) {
    throw new BusinessRuleError(
      "Informe a justificativa do orçamento manual — obrigatória quando não vem da calculadora.",
    );
  }

  let originalValue: Prisma.Decimal;
  let discount: Prisma.Decimal;
  try {
    originalValue = toDecimal(input.originalValue);
    discount = toDecimal(input.discount ?? 0);
  } catch {
    throw new BusinessRuleError("Valor original ou desconto inválidos.");
  }
  if (originalValue.lessThanOrEqualTo(0)) {
    throw new BusinessRuleError("O valor original do orçamento manual deve ser maior que zero.");
  }
  if (discount.lessThan(0)) throw new BusinessRuleError("O desconto não pode ser negativo.");

  const finalValue = originalValue.minus(discount);
  if (finalValue.lessThan(0)) {
    throw new BusinessRuleError("O desconto não pode ser maior do que o valor original.");
  }

  const quantity = normalizeQuantity(input.quantity ?? 1);

  const created = await prisma.$transaction(async (tx) => {
    const quote = await getOrCreateQuote(tx, input.opportunityId);
    const versionNumber = await nextVersionNumber(tx, quote.id);

    const version = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber,
        jobId: null,
        isManual: true,
        manualJustification: justification,
        originalValue,
        discount,
        finalValue,
        paymentTerms: input.paymentTerms?.trim() || null,
        deliveryDeadline: input.deliveryDeadline ?? null,
        quantity,
        notes: input.notes?.trim() || null,
        status: "DRAFT",
      },
    });

    await tx.quote.update({ where: { id: quote.id }, data: { status: "DRAFT" } });

    await recordAudit(
      {
        entityType: "quote_version",
        entityId: version.id,
        action: "quote_version.create",
        after: {
          quoteId: quote.id,
          opportunityId: input.opportunityId,
          versionNumber,
          source: "manual",
          manualJustification: justification,
          originalValue: originalValue.toString(),
          discount: discount.toString(),
          finalValue: finalValue.toString(),
        },
        userId: actorUserId,
      },
      tx,
    );

    return version;
  });

  return created;
}

// --- transições de status de uma versão ---------------------------------------

/** Marca uma versão como enviada ao cliente (registra `sentAt`). */
export async function sendVersion(quoteVersionId: string, actorUserId: string): Promise<QuoteVersion> {
  const version = await prisma.quoteVersion.findUnique({ where: { id: quoteVersionId } });
  if (!version) throw new BusinessRuleError("Versão de orçamento não encontrada.");
  if (version.status !== "DRAFT") {
    throw new BusinessRuleError("Só é possível marcar como enviada uma versão em rascunho.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.quoteVersion.update({
      where: { id: quoteVersionId },
      data: { status: "SENT", sentAt: new Date() },
    });
    await tx.quote.update({ where: { id: version.quoteId }, data: { status: "SENT" } });

    await recordAudit(
      {
        entityType: "quote_version",
        entityId: quoteVersionId,
        action: "quote_version.send",
        before: { status: version.status },
        after: { status: "SENT" },
        userId: actorUserId,
      },
      tx,
    );

    return after;
  });

  return updated;
}

/**
 * Aprova uma versão de orçamento. Nunca edita valores — só o status e
 * `acceptedAt` da própria versão sendo aprovada. Versões já decididas
 * (aprovadas ou rejeitadas) não podem ser reaprovadas: a correção é sempre
 * uma nova versão.
 *
 * Sprint 6 (PROD-1, decisão "Política de estoque" da Etapa 1 §03): quando a
 * versão aprovada veio de um Job calculado (`version.jobId` preenchido), a
 * MESMA transação da aprovação também RESERVA o filamento estimado de cada
 * `JobFilament` (reaproveitando a escrita condicional atômica de
 * `recordMovementInTx` — nunca duplicar essa lógica) e cria a
 * `ProductionOrder` (status AGUARDANDO). Se qualquer filamento não tiver
 * saldo suficiente, a transação inteira falha: a versão NÃO fica aprovada,
 * NENHUM filamento é reservado, NENHUMA ordem é criada — caso crítico
 * combinado PROD-5 ("impedir reserva sem saldo") + "alterar orçamento já
 * aprovado" (nada fica em estado parcial).
 *
 * TODO (documentado, não um bug): quando a versão é MANUAL (`jobId` nulo),
 * nada disso acontece aqui — não há Job para estimar filamentos. Nesse caso
 * o usuário cria a ordem de produção manualmente
 * (src/modules/production/services/production.ts,
 * `createManualProductionOrder`, exposta na UI da página da oportunidade),
 * sem reserva automática de estoque.
 */
export async function approveVersion(quoteVersionId: string, actorUserId: string): Promise<QuoteVersion> {
  const version = await prisma.quoteVersion.findUnique({ where: { id: quoteVersionId } });
  if (!version) throw new BusinessRuleError("Versão de orçamento não encontrada.");
  if (version.status === "APPROVED") {
    throw new BusinessRuleError("Esta versão já está aprovada.");
  }
  if (version.status === "REJECTED") {
    throw new BusinessRuleError(
      "Esta versão foi rejeitada e não pode mais ser aprovada — crie uma nova versão.",
    );
  }

  // Leitura fora da transação (só decide SE vamos reservar/gerar ordem, não
  // aplica nada ainda) — evita segurar a transação de escrita mais que o
  // necessário enquanto resolvemos de qual job/oportunidade se trata.
  let jobFilaments: { filamentId: string; gramsUsed: Prisma.Decimal }[] = [];
  let opportunityId: string | null = null;
  if (version.jobId) {
    const job = await prisma.job.findUnique({
      where: { id: version.jobId },
      include: { jobFilaments: true },
    });
    if (!job) throw new BusinessRuleError("Job de origem deste orçamento não foi encontrado.");
    jobFilaments = job.jobFilaments.map((jf) => ({ filamentId: jf.filamentId, gramsUsed: jf.gramsUsed }));

    const quote = await prisma.quote.findUnique({ where: { id: version.quoteId } });
    if (!quote) throw new BusinessRuleError("Orçamento não encontrado.");
    opportunityId = quote.opportunityId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.quoteVersion.update({
      where: { id: quoteVersionId },
      data: { status: "APPROVED", acceptedAt: new Date() },
    });
    await tx.quote.update({ where: { id: version.quoteId }, data: { status: "APPROVED" } });

    await recordAudit(
      {
        entityType: "quote_version",
        entityId: quoteVersionId,
        action: "quote_version.approve",
        before: { status: version.status },
        after: { status: "APPROVED" },
        userId: actorUserId,
      },
      tx,
    );

    if (version.jobId && opportunityId) {
      // Reserva cada filamento do job — se QUALQUER um não tiver saldo, o
      // erro propaga e o Prisma reverte a transação inteira (nenhuma
      // aprovação, nenhuma reserva parcial, nenhuma ordem).
      for (const jf of jobFilaments) {
        try {
          await recordMovementInTx(
            tx,
            {
              filamentId: jf.filamentId,
              type: "RESERVA",
              quantityGrams: jf.gramsUsed,
              reason: `Reserva automática — orçamento aprovado (job ${version.jobId}).`,
            },
            actorUserId,
          );
        } catch (err) {
          if (err instanceof FilamentBusinessRuleError) throw new BusinessRuleError(err.message);
          throw err;
        }
      }

      // Ordem de produção gerada automaticamente (PROD-2), status inicial
      // AGUARDANDO. `plannedEndAt` nasce com o prazo de entrega já negociado
      // na versão (quando informado) — ajustável depois pelo Operador via
      // `updateProductionOrderDetails`, não é um valor travado.
      const order = await tx.productionOrder.create({
        data: {
          opportunityId,
          jobId: version.jobId,
          plannedStartAt: new Date(),
          plannedEndAt: version.deliveryDeadline ?? null,
          printStatus: "AGUARDANDO",
        },
      });

      await recordAudit(
        {
          entityType: "production_order",
          entityId: order.id,
          action: "production_order.create",
          after: { opportunityId, jobId: version.jobId, source: "quote_approval" },
          userId: actorUserId,
        },
        tx,
      );
    }

    return after;
  });

  return updated;
}

/**
 * Rejeita uma versão de orçamento — motivo obrigatório (registrado como
 * `lostReason` no cabeçalho `Quote`). Versões já decididas não podem ser
 * rejeitadas de novo; a correção é sempre uma nova versão.
 */
export async function rejectVersion(
  quoteVersionId: string,
  reason: string,
  actorUserId: string,
): Promise<QuoteVersion> {
  const trimmedReason = reason?.trim() ?? "";
  if (!trimmedReason) throw new BusinessRuleError("Informe o motivo da rejeição/perda do orçamento.");

  const version = await prisma.quoteVersion.findUnique({ where: { id: quoteVersionId } });
  if (!version) throw new BusinessRuleError("Versão de orçamento não encontrada.");
  if (version.status === "APPROVED") {
    throw new BusinessRuleError("Esta versão já foi aprovada e não pode ser rejeitada.");
  }
  if (version.status === "REJECTED") {
    throw new BusinessRuleError("Esta versão já foi rejeitada.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.quoteVersion.update({
      where: { id: quoteVersionId },
      data: { status: "REJECTED" },
    });
    await tx.quote.update({
      where: { id: version.quoteId },
      data: { status: "REJECTED", lostReason: trimmedReason },
    });

    await recordAudit(
      {
        entityType: "quote_version",
        entityId: quoteVersionId,
        action: "quote_version.reject",
        before: { status: version.status },
        after: { status: "REJECTED" },
        reason: trimmedReason,
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
 * Checa se existe QUALQUER `QuoteVersion` aprovada vinculada à oportunidade
 * — usado por src/modules/crm/services/opportunities.ts (`moveStage`) para
 * popular a pré-condição real de Negociação → Desenvolvimento.
 */
export async function hasApprovedQuoteVersion(opportunityId: string): Promise<boolean> {
  const found = await prisma.quoteVersion.findFirst({
    where: { status: "APPROVED", quote: { opportunityId } },
    select: { id: true },
  });
  return Boolean(found);
}

export async function getQuoteWithVersions(opportunityId: string) {
  return prisma.quote.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          job: { select: { id: true, finalPrice: true, project: { select: { id: true, name: true } } } },
        },
      },
    },
  });
}
