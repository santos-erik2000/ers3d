// Financeiro (Etapa 5, Sprint 9 — épico E8, histórias FIN-1..FIN-4). Ver o
// cabeçalho de `AccountsReceivable`/`PaymentInstallment`/`FinancialTransaction`
// em prisma/schema.prisma para o desenho completo e as decisões de modelagem
// (status próprio da parcela, pagamento parcial via `amountPaid`, estorno
// nunca apaga a transação original).
//
// REGRA MAIS IMPORTANTE: o valor negociado aprovado NUNCA é tratado como
// dinheiro em caixa. `createAccountsReceivableInTx` só registra uma
// expectativa (status PREVISTO); só `recordPayment`/`reverseTransaction`
// tocam `FinancialTransaction` — a ÚNICA fonte que representa dinheiro de
// fato entrando/saindo do caixa.
//
// Este módulo não importa nada de `quotes`/`crm` — só `audit`, mesmo padrão
// de `inventory`/`filaments`. É `quotes.ts` (`approveVersion`) quem chama
// `createAccountsReceivableInTx` dentro da própria transação da aprovação
// (mesma direção de `production.ts` chamar `recordMovementInTx` de
// `filaments.ts`), e `crm/services/opportunities.ts` (`moveStage`) quem
// chama as funções de leitura daqui para popular a pré-condição financeira
// de Entrega → Concluído — sem ciclo entre módulos de serviço.

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { computeAggregateStatus, computeInstallmentStatus } from "@/modules/finance/format";
import {
  Prisma,
  type AccountsReceivable,
  type FinancialTransaction,
  type PaymentInstallment,
  type PaymentMethod,
} from "@prisma/client";

export class BusinessRuleError extends Error {}

function toDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  if (decimal.isNaN()) throw new Error("not a number");
  return decimal;
}

const VALID_PAYMENT_METHODS: PaymentMethod[] = ["PIX", "MAQUININHA"];

// --- nascimento da conta a receber (FIN-1) ----------------------------------

export type CreateAccountsReceivableInput = {
  opportunityId: string;
  quoteVersionId: string;
  grossValue: Prisma.Decimal.Value;
  discount: Prisma.Decimal.Value;
  netValue: Prisma.Decimal.Value;
  dueDate?: Date | null;
};

/**
 * Cria a AccountsReceivable (status SEMPRE PREVISTO — FIN-1, "nunca receita
 * já realizada") e a PRIMEIRA PaymentInstallment, cobrindo o valor total
 * (`netValue`) — o usuário pode redistribuir em mais parcelas depois via
 * `splitInstallments`. Chamada dentro do `tx` já aberto pelo chamador
 * (src/modules/quotes/services/quotes.ts, `approveVersion`), na MESMA
 * transação em que — quando a versão tem job — o filamento é reservado e a
 * ProductionOrder é criada. Diferente da reserva de estoque, esta função é
 * chamada SEMPRE que uma versão é aprovada, com ou sem job: o financeiro não
 * depende de haver produção física, só de haver um valor negociado aprovado.
 */
export async function createAccountsReceivableInTx(
  tx: Prisma.TransactionClient,
  input: CreateAccountsReceivableInput,
  actorUserId: string,
): Promise<AccountsReceivable> {
  const grossValue = toDecimal(input.grossValue);
  const discount = toDecimal(input.discount);
  const netValue = toDecimal(input.netValue);
  if (netValue.lessThan(0)) {
    throw new BusinessRuleError("O valor líquido da conta a receber não pode ser negativo.");
  }

  const accountsReceivable = await tx.accountsReceivable.create({
    data: {
      opportunityId: input.opportunityId,
      quoteVersionId: input.quoteVersionId,
      grossValue,
      discount,
      netValue,
      status: "PREVISTO",
      dueDate: input.dueDate ?? null,
    },
  });

  const installment = await tx.paymentInstallment.create({
    data: {
      accountsReceivableId: accountsReceivable.id,
      installmentNumber: 1,
      amount: netValue,
      amountPaid: new Prisma.Decimal(0),
      dueDate: input.dueDate ?? null,
      status: "PENDENTE",
    },
  });

  await recordAudit(
    {
      entityType: "accounts_receivable",
      entityId: accountsReceivable.id,
      action: "accounts_receivable.create",
      after: {
        opportunityId: input.opportunityId,
        quoteVersionId: input.quoteVersionId,
        netValue: netValue.toString(),
        status: "PREVISTO",
        initialInstallmentId: installment.id,
      },
      userId: actorUserId,
    },
    tx,
  );

  return accountsReceivable;
}

// --- divisão de parcelas -----------------------------------------------------

/**
 * Redistribui o valor total (`netValue`) da AccountsReceivable em `count`
 * parcelas — só permitido quando NENHUMA parcela atual já teve qualquer
 * `FinancialTransaction` registrada (nenhum pagamento em andamento): dividir
 * depois de já existir pagamento exigiria decidir a quem atribuir o que já
 * foi pago, o que este sprint não cobre (o usuário deve dividir ANTES de
 * começar a receber). Distribuição em centavos (nunca `Decimal.dividedBy`
 * direto, que pode gerar dízima) — o resto da divisão fica nas primeiras
 * parcelas, para a soma nunca derivar do valor total original.
 */
export async function splitInstallments(
  accountsReceivableId: string,
  count: number,
  actorUserId: string,
  dueDates?: (Date | null)[],
): Promise<PaymentInstallment[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new BusinessRuleError("Informe um número de parcelas inteiro maior que zero.");
  }

  const accountsReceivable = await prisma.accountsReceivable.findUnique({
    where: { id: accountsReceivableId },
    include: { installments: { include: { transactions: true } } },
  });
  if (!accountsReceivable) throw new BusinessRuleError("Conta a receber não encontrada.");

  const hasAnyTransaction = accountsReceivable.installments.some((i) => i.transactions.length > 0);
  if (hasAnyTransaction) {
    throw new BusinessRuleError(
      "Não é possível redividir em parcelas depois que algum pagamento já foi registrado nesta conta.",
    );
  }

  const totalCents = accountsReceivable.netValue.times(100).toDecimalPlaces(0).toNumber();
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  const amounts: Prisma.Decimal[] = Array.from({ length: count }, (_, i) => {
    const cents = baseCents + (i < remainderCents ? 1 : 0);
    return new Prisma.Decimal(cents).dividedBy(100);
  });

  const created = await prisma.$transaction(async (tx) => {
    await tx.paymentInstallment.deleteMany({ where: { accountsReceivableId } });

    const installments: PaymentInstallment[] = [];
    for (const [i, installmentAmount] of amounts.entries()) {
      const installment = await tx.paymentInstallment.create({
        data: {
          accountsReceivableId,
          installmentNumber: i + 1,
          amount: installmentAmount,
          amountPaid: new Prisma.Decimal(0),
          dueDate: dueDates?.[i] ?? accountsReceivable.dueDate ?? null,
          status: "PENDENTE",
        },
      });
      installments.push(installment);
    }

    await recordAudit(
      {
        entityType: "accounts_receivable",
        entityId: accountsReceivableId,
        action: "accounts_receivable.split_installments",
        before: { installmentCount: accountsReceivable.installments.length },
        after: { installmentCount: count },
        userId: actorUserId,
      },
      tx,
    );

    return installments;
  });

  return created;
}

// --- baixa manual (FIN-2) ----------------------------------------------------

export type RecordPaymentInput = {
  installmentId: string;
  amount: Prisma.Decimal.Value;
  paymentMethod: PaymentMethod;
  paidAt?: Date | null;
};

export type RecordPaymentResult = {
  installment: PaymentInstallment;
  transaction: FinancialTransaction;
  accountsReceivable: AccountsReceivable;
};

/**
 * Registra a baixa manual de um pagamento (FIN-2) — cria a
 * `FinancialTransaction` (única fonte que de fato move o caixa), atualiza
 * `amountPaid`/`status` da parcela e recalcula o status agregado da
 * AccountsReceivable. Suporta PAGAMENTO PARCIAL: `amount` pode ser menor que
 * o saldo restante da parcela (`amount - amountPaid`) — nunca precisa saldar
 * a parcela inteira de uma vez. Nunca permite pagar mais do que o saldo
 * restante (evitaria `amountPaid > amount`, dinheiro "sobrando" sem
 * destino).
 */
export async function recordPayment(input: RecordPaymentInput, actorUserId: string): Promise<RecordPaymentResult> {
  let amount: Prisma.Decimal;
  try {
    amount = toDecimal(input.amount);
  } catch {
    throw new BusinessRuleError("Valor de pagamento inválido.");
  }
  if (amount.lessThanOrEqualTo(0)) {
    throw new BusinessRuleError("Informe um valor de pagamento maior que zero.");
  }
  if (!VALID_PAYMENT_METHODS.includes(input.paymentMethod)) {
    throw new BusinessRuleError("Forma de pagamento inválida — só Pix ou maquininha.");
  }

  const installment = await prisma.paymentInstallment.findUnique({
    where: { id: input.installmentId },
    include: { accountsReceivable: { include: { installments: true } } },
  });
  if (!installment) throw new BusinessRuleError("Parcela não encontrada.");

  const remaining = installment.amount.minus(installment.amountPaid);
  if (remaining.lessThanOrEqualTo(0)) {
    throw new BusinessRuleError("Esta parcela já está totalmente paga.");
  }
  if (amount.greaterThan(remaining)) {
    throw new BusinessRuleError(
      `O valor informado (${amount.toString()}) é maior do que o saldo restante da parcela (${remaining.toString()}).`,
    );
  }

  const paidAt = input.paidAt ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.financialTransaction.create({
      data: {
        installmentId: installment.id,
        type: "RECEBIMENTO",
        amount,
        transactionDate: paidAt,
        registeredById: actorUserId,
      },
    });

    const newAmountPaid = installment.amountPaid.plus(amount);
    const newInstallmentStatus = computeInstallmentStatus(installment.amount, newAmountPaid, installment.dueDate, paidAt);

    const updatedInstallment = await tx.paymentInstallment.update({
      where: { id: installment.id },
      data: {
        amountPaid: newAmountPaid,
        status: newInstallmentStatus,
        paymentMethod: input.paymentMethod,
        paidAt: newInstallmentStatus === "PAGO" ? paidAt : null,
      },
    });

    const siblingInstallments = installment.accountsReceivable.installments.map((i) =>
      i.id === updatedInstallment.id ? updatedInstallment : i,
    );
    const aggregateStatus = computeAggregateStatus(siblingInstallments, paidAt);

    const updatedAccountsReceivable = await tx.accountsReceivable.update({
      where: { id: installment.accountsReceivableId },
      data: { status: aggregateStatus },
    });

    await recordAudit(
      {
        entityType: "payment_installment",
        entityId: installment.id,
        action: "payment_installment.record_payment",
        before: { amountPaid: installment.amountPaid.toString(), status: installment.status },
        after: { amountPaid: newAmountPaid.toString(), status: newInstallmentStatus },
        userId: actorUserId,
      },
      tx,
    );

    return { installment: updatedInstallment, transaction, accountsReceivable: updatedAccountsReceivable };
  });

  return result;
}

// --- estorno -------------------------------------------------------------------

export type ReverseTransactionResult = {
  transaction: FinancialTransaction;
  installment: PaymentInstallment;
  accountsReceivable: AccountsReceivable;
};

/**
 * Estorna uma FinancialTransaction do tipo RECEBIMENTO — NUNCA apaga/altera
 * a transação original. Cria uma NOVA transação, tipo ESTORNO, valor
 * NEGATIVO (compensatório, exatamente o oposto do valor original — este
 * sprint só cobre estorno TOTAL de uma transação, não estorno parcial),
 * vinculada à mesma parcela, referenciando a original via
 * `reversesTransactionId` (`@unique` no schema — uma transação nunca pode
 * ser estornada duas vezes, reforçado aqui e no banco). Motivo obrigatório.
 * Recalcula `amountPaid`/status da parcela e o status agregado da
 * AccountsReceivable, exatamente como `recordPayment`.
 */
export async function reverseTransaction(
  transactionId: string,
  reason: string,
  actorUserId: string,
): Promise<ReverseTransactionResult> {
  const trimmedReason = reason?.trim() ?? "";
  if (!trimmedReason) throw new BusinessRuleError("Informe o motivo do estorno — obrigatório.");

  const original = await prisma.financialTransaction.findUnique({
    where: { id: transactionId },
    include: {
      installment: { include: { accountsReceivable: { include: { installments: true } } } },
      reversal: true,
    },
  });
  if (!original) throw new BusinessRuleError("Transação não encontrada.");
  if (original.type !== "RECEBIMENTO") {
    throw new BusinessRuleError("Só é possível estornar uma transação do tipo Recebimento.");
  }
  if (original.reversal) {
    throw new BusinessRuleError("Esta transação já foi estornada anteriormente.");
  }

  const now = new Date();
  const installment = original.installment;

  const result = await prisma.$transaction(async (tx) => {
    const reversalTransaction = await tx.financialTransaction.create({
      data: {
        installmentId: original.installmentId,
        type: "ESTORNO",
        amount: original.amount.negated(),
        transactionDate: now,
        registeredById: actorUserId,
        reversesTransactionId: original.id,
      },
    });

    const rawAmountPaid = installment.amountPaid.minus(original.amount);
    // Nunca deixa amountPaid negativo mesmo em cenários inesperados (defesa
    // extra — na prática não deveria acontecer, já que a soma de RECEBIMENTOs
    // menos ESTORNOs de uma parcela nunca deveria exceder o que foi somado).
    const newAmountPaid = rawAmountPaid.lessThan(0) ? new Prisma.Decimal(0) : rawAmountPaid;
    const newInstallmentStatus = computeInstallmentStatus(installment.amount, newAmountPaid, installment.dueDate, now);

    const updatedInstallment = await tx.paymentInstallment.update({
      where: { id: installment.id },
      data: {
        amountPaid: newAmountPaid,
        status: newInstallmentStatus,
        paidAt: newInstallmentStatus === "PAGO" ? installment.paidAt : null,
      },
    });

    const siblingInstallments = installment.accountsReceivable.installments.map((i) =>
      i.id === updatedInstallment.id ? updatedInstallment : i,
    );
    const aggregateStatus = computeAggregateStatus(siblingInstallments, now);

    const updatedAccountsReceivable = await tx.accountsReceivable.update({
      where: { id: installment.accountsReceivableId },
      data: { status: aggregateStatus },
    });

    await recordAudit(
      {
        entityType: "financial_transaction",
        entityId: reversalTransaction.id,
        action: "financial_transaction.reverse",
        before: { originalTransactionId: original.id, amount: original.amount.toString() },
        after: { amount: reversalTransaction.amount.toString() },
        reason: trimmedReason,
        userId: actorUserId,
      },
      tx,
    );

    return {
      transaction: reversalTransaction,
      installment: updatedInstallment,
      accountsReceivable: updatedAccountsReceivable,
    };
  });

  return result;
}

// --- leitura --------------------------------------------------------------------

/** AccountsReceivable MAIS RECENTE da oportunidade, com parcelas e transações — base do painel financeiro em /crm/[id]. */
export async function getAccountsReceivableByOpportunity(opportunityId: string) {
  return prisma.accountsReceivable.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    include: {
      installments: {
        orderBy: { installmentNumber: "asc" },
        include: {
          transactions: {
            orderBy: { transactionDate: "desc" },
            include: {
              registeredBy: { select: { id: true, name: true } },
              // Só preenchido quando esta transação (RECEBIMENTO) já foi
              // estornada — usado pela UI (src/app/(app)/crm/[id]/finance-panel.tsx)
              // para esconder o botão "Estornar" de uma transação já estornada
              // (o service também rejeita, mas a UI evita o clique inútil).
              reversal: { select: { id: true } },
            },
          },
        },
      },
      quoteVersion: { select: { id: true, versionNumber: true } },
    },
  });
}

/**
 * Existe uma AccountsReceivable para a oportunidade (situação financeira
 * conhecida) e ela está PAGA? Usado por
 * src/modules/crm/services/opportunities.ts (`moveStage`) para popular a
 * quarta pré-condição de Entrega → Concluído — sempre olha a MAIS RECENTE
 * (mesmo padrão de `hasApprovedQualityCheck`/`hasDeliveredDelivery`).
 */
export async function getAccountsReceivableStatusForOpportunity(
  opportunityId: string,
): Promise<{ exists: boolean; isPaid: boolean }> {
  const latest = await prisma.accountsReceivable.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!latest) return { exists: false, isPaid: false };
  return { exists: true, isPaid: latest.status === "PAGO" };
}

/** Visão agregada de todas as contas a receber (todas as oportunidades) — base da rota /financeiro. */
export async function listAccountsReceivable() {
  return prisma.accountsReceivable.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      opportunity: { select: { id: true, title: true } },
      installments: { orderBy: { installmentNumber: "asc" } },
    },
  });
}
