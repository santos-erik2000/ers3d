// Helpers de formatação/apresentação + funções puras de cálculo de status
// para o módulo Financeiro (Sprint 9 — épico E8) — sem Prisma/IO, usáveis em
// client ou server (mesmo padrão de src/modules/crm/format.ts e
// src/modules/production/format.ts). A regra de negócio "de verdade" (escrita
// no banco) vive em services/receivables.ts; aqui é só como calcular/exibir o
// que já foi decidido lá.
//
// `computeInstallmentStatus`/`computeAggregateStatus` são as MESMAS funções
// usadas em dois momentos:
//   1. src/modules/finance/services/receivables.ts (`recordPayment`,
//      `reverseTransaction`) grava o resultado no banco a cada escrita — é
//      isso que a regra de negócio quer dizer com "calculado, não um cron":
//      o cálculo acontece inline, na hora do evento, nunca por um job
//      agendado rodando em background.
//   2. Opcionalmente, a camada de leitura (telas /financeiro, painel em
//      /crm/[id]) pode recomputar ao vivo com a MESMA função para exibir o
//      status "VENCIDO" corretamente mesmo que nenhuma escrita tenha
//      acontecido desde que o prazo passou — mesma limitação já documentada
//      de outros "contadores calculados" deste projeto (ex.
//      `getProductionDeadlineCounter`, src/modules/production/format.ts): o
//      valor gravado no banco pode ficar defasado entre duas escritas, mas a
//      tela nunca precisa mostrar um valor errado, porque pode recalcular.

import { Prisma } from "@prisma/client";
import type {
  AccountsReceivableStatus,
  FinancialTransactionType,
  InstallmentStatus,
  PaymentMethod,
} from "@prisma/client";

export const ACCOUNTS_RECEIVABLE_STATUS_LABEL: Record<AccountsReceivableStatus, string> = {
  PREVISTO: "Previsto",
  PENDENTE: "Pendente",
  PARCIALMENTE_PAGO: "Parcialmente pago",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  ESTORNADO: "Estornado",
};

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  PENDENTE: "Pendente",
  PARCIALMENTE_PAGO: "Parcialmente pago",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: "Pix",
  MAQUININHA: "Maquininha",
};

export const TRANSACTION_TYPE_LABEL: Record<FinancialTransactionType, string> = {
  RECEBIMENTO: "Recebimento",
  ESTORNO: "Estorno",
};

// Cores semânticas já definidas em globals.css/tailwind.config.ts — nunca só
// cor sem texto (regra da Etapa 4 / DoD), sempre acompanhadas do rótulo acima.
export type StatusTone = "neutral" | "warning" | "success" | "danger";

export const ACCOUNTS_RECEIVABLE_STATUS_TONE: Record<AccountsReceivableStatus, StatusTone> = {
  PREVISTO: "neutral",
  PENDENTE: "warning",
  PARCIALMENTE_PAGO: "warning",
  PAGO: "success",
  VENCIDO: "danger",
  CANCELADO: "neutral",
  ESTORNADO: "neutral",
};

export const INSTALLMENT_STATUS_TONE: Record<InstallmentStatus, StatusTone> = {
  PENDENTE: "warning",
  PARCIALMENTE_PAGO: "warning",
  PAGO: "success",
  VENCIDO: "danger",
  CANCELADO: "neutral",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "object" ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}

type InstallmentLike = {
  amount: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  dueDate: Date | null;
};

/**
 * Status de UMA parcela a partir do quanto já foi pago e do vencimento.
 * Nunca retorna CANCELADO (reservado para cancelamento manual, fora de
 * escopo deste sprint — ver comentário em `InstallmentStatus` no schema).
 */
export function computeInstallmentStatus(
  amount: Prisma.Decimal,
  amountPaid: Prisma.Decimal,
  dueDate: Date | null,
  now: Date = new Date(),
): InstallmentStatus {
  if (amountPaid.greaterThanOrEqualTo(amount)) return "PAGO";
  if (amountPaid.greaterThan(0)) return "PARCIALMENTE_PAGO";
  if (dueDate && dueDate.getTime() < now.getTime()) return "VENCIDO";
  return "PENDENTE";
}

/**
 * Status agregado da AccountsReceivable a partir de TODAS as suas parcelas —
 * regra literal do briefing: "todas as parcelas pagas → PAGO; alguma paga e
 * alguma não → PARCIALMENTE_PAGO; nenhuma paga e ainda dentro do prazo →
 * PENDENTE; nenhuma paga e vencida → VENCIDO". Nunca retorna PREVISTO (esse
 * status só existe no instante da criação, antes de qualquer parcela ser
 * tocada — ver `createAccountsReceivableInTx`) nem CANCELADO/ESTORNADO
 * (reservados para operações fora de escopo deste sprint).
 */
export function computeAggregateStatus(
  installments: InstallmentLike[],
  now: Date = new Date(),
): AccountsReceivableStatus {
  if (installments.length === 0) return "PENDENTE";

  const allPaid = installments.every((i) => i.amountPaid.greaterThanOrEqualTo(i.amount));
  if (allPaid) return "PAGO";

  const anyPaid = installments.some((i) => i.amountPaid.greaterThan(0));
  if (anyPaid) return "PARCIALMENTE_PAGO";

  const anyOverdue = installments.some((i) => i.dueDate && i.dueDate.getTime() < now.getTime());
  return anyOverdue ? "VENCIDO" : "PENDENTE";
}
