"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  recordPaymentAction,
  reverseTransactionAction,
  splitInstallmentsAction,
  type FinanceFormState,
} from "@/modules/finance/actions";
import {
  ACCOUNTS_RECEIVABLE_STATUS_LABEL,
  ACCOUNTS_RECEIVABLE_STATUS_TONE,
  INSTALLMENT_STATUS_LABEL,
  INSTALLMENT_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
  TRANSACTION_TYPE_LABEL,
  formatCurrency,
} from "@/modules/finance/format";
import type { AccountsReceivableStatus, InstallmentStatus, PaymentMethod } from "@prisma/client";

export type FinanceTransactionView = {
  id: string;
  type: "RECEBIMENTO" | "ESTORNO";
  amount: string;
  transactionDate: string;
  registeredByName: string | null;
  hasReversal: boolean;
};

export type FinanceInstallmentView = {
  id: string;
  installmentNumber: number;
  amount: string;
  amountPaid: string;
  dueDate: string | null;
  status: InstallmentStatus;
  paymentMethod: PaymentMethod | null;
  transactions: FinanceTransactionView[];
};

export type FinanceView = {
  id: string;
  grossValue: string;
  discount: string;
  netValue: string;
  status: AccountsReceivableStatus;
  dueDate: string | null;
  installments: FinanceInstallmentView[];
};

const initialState: FinanceFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-neutral-soft text-neutral",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

const METHOD_OPTIONS: PaymentMethod[] = ["PIX", "MAQUININHA"];

/**
 * Painel financeiro da oportunidade (Sprint 9 — FIN-1/FIN-2/FIN-4): mostra a
 * AccountsReceivable mais recente (nasce automaticamente quando uma versão
 * de orçamento é aprovada — src/modules/quotes/services/quotes.ts,
 * `approveVersion`), suas parcelas e o histórico de transações, com os
 * botões de dar baixa (pagamento parcial suportado) e estornar. Dividir em
 * mais parcelas só fica disponível enquanto nenhum pagamento foi registrado
 * ainda (mesma regra do service).
 *
 * As ações de escrita aqui exigem `finance.manage` no backend
 * (`requirePermission`, dentro de cada Server Action) — esta página em si já
 * exige `crm.manage` para ser visitada (ver src/app/(app)/crm/[id]/page.tsx),
 * então o Contador (que só tem `finance.read`) não chega até aqui; a leitura
 * dele acontece em /financeiro, sem nenhum botão de ação.
 */
export function FinancePanel({ opportunityId, accountsReceivable }: { opportunityId: string; accountsReceivable: FinanceView | null }) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);

  if (!accountsReceivable) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Financeiro</h2>
        <p className="mt-2 text-xs text-text-muted">
          A conta a receber aparece aqui automaticamente quando uma versão de orçamento desta oportunidade é
          aprovada.
        </p>
      </section>
    );
  }

  const hasAnyPayment = accountsReceivable.installments.some((i) => i.transactions.length > 0);

  async function handleReverse(transactionId: string) {
    const reason = window.prompt("Motivo do estorno (obrigatório):");
    if (!reason || !reason.trim()) return;
    setActionError(null);
    setPendingTransactionId(transactionId);
    const result = await reverseTransactionAction(transactionId, reason.trim(), opportunityId);
    setPendingTransactionId(null);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Financeiro</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[ACCOUNTS_RECEIVABLE_STATUS_TONE[accountsReceivable.status]]}`}
        >
          {ACCOUNTS_RECEIVABLE_STATUS_LABEL[accountsReceivable.status]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Valor bruto" value={formatCurrency(accountsReceivable.grossValue)} />
        <Row label="Desconto" value={formatCurrency(accountsReceivable.discount)} />
        <Row label="Valor líquido" value={formatCurrency(accountsReceivable.netValue)} />
        <Row
          label="Vencimento"
          value={accountsReceivable.dueDate ? new Date(accountsReceivable.dueDate).toLocaleDateString("pt-BR") : "—"}
        />
      </dl>

      {actionError && (
        <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {accountsReceivable.installments.map((installment) => (
          <div key={installment.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">Parcela {installment.installmentNumber}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[INSTALLMENT_STATUS_TONE[installment.status]]}`}
              >
                {INSTALLMENT_STATUS_LABEL[installment.status]}
              </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
              <Row label="Valor" value={formatCurrency(installment.amount)} />
              <Row label="Pago" value={formatCurrency(installment.amountPaid)} />
              <Row
                label="Vencimento"
                value={installment.dueDate ? new Date(installment.dueDate).toLocaleDateString("pt-BR") : "—"}
              />
              {installment.paymentMethod && (
                <Row label="Forma de pagamento" value={PAYMENT_METHOD_LABEL[installment.paymentMethod]} />
              )}
            </dl>

            {installment.transactions.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2 text-xs text-text-muted">
                {installment.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span>
                      {TRANSACTION_TYPE_LABEL[t.type]} · {formatCurrency(t.amount)} ·{" "}
                      {new Date(t.transactionDate).toLocaleString("pt-BR")}
                      {t.registeredByName ? ` · ${t.registeredByName}` : ""}
                    </span>
                    {t.type === "RECEBIMENTO" && !t.hasReversal && (
                      <button
                        type="button"
                        onClick={() => handleReverse(t.id)}
                        disabled={pendingTransactionId === t.id}
                        className="shrink-0 rounded-sm border border-danger px-2 py-0.5 text-xs text-danger transition hover:bg-danger-soft disabled:opacity-60"
                      >
                        Estornar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {installment.status !== "PAGO" && installment.status !== "CANCELADO" && (
              <RecordPaymentForm opportunityId={opportunityId} installmentId={installment.id} />
            )}
          </div>
        ))}
      </div>

      {!hasAnyPayment && accountsReceivable.installments.length > 0 && (
        <SplitInstallmentsForm opportunityId={opportunityId} accountsReceivableId={accountsReceivable.id} />
      )}
    </section>
  );
}

function RecordPaymentForm({ opportunityId, installmentId }: { opportunityId: string; installmentId: string }) {
  const [state, formAction, pending] = useActionState(recordPaymentAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <input type="hidden" name="installmentId" value={installmentId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="Valor pago (R$)" required className={inputClass} />
        <select name="paymentMethod" defaultValue="PIX" className={inputClass}>
          {METHOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <input name="paidAt" type="date" className={inputClass} />
      </div>
      {state?.error && <FormError message={state.error} />}
      <SubmitButton pending={pending} label="Registrar pagamento" />
    </form>
  );
}

function SplitInstallmentsForm({
  opportunityId,
  accountsReceivableId,
}: {
  opportunityId: string;
  accountsReceivableId: string;
}) {
  const [state, formAction, pending] = useActionState(splitInstallmentsAction, initialState);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">Dividir em parcelas</h3>
      <p className="mt-1 text-xs text-text-muted">
        Redistribui o valor líquido total em N parcelas iguais — só disponível antes de qualquer pagamento.
      </p>
      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="accountsReceivableId" value={accountsReceivableId} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input
          name="count"
          type="number"
          step="1"
          min="1"
          placeholder="Número de parcelas"
          required
          className={inputClass + " w-40"}
        />
        <SubmitButton pending={pending} label="Dividir" />
      </form>
      {state?.error && <FormError message={state.error} />}
    </div>
  );
}

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
    >
      {pending ? "Salvando…" : label}
    </button>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt>{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}
