"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveQuoteVersionAction,
  createManualVersionAction,
  createVersionFromJobAction,
  rejectQuoteVersionAction,
  sendQuoteVersionAction,
  type QuoteFormState,
} from "@/modules/quotes/actions";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, formatCurrency } from "@/modules/quotes/format";
import type { QuoteStatus } from "@prisma/client";

export type QuoteVersionView = {
  id: string;
  versionNumber: number;
  status: QuoteStatus;
  isManual: boolean;
  manualJustification: string | null;
  originalValue: string;
  discount: string;
  finalValue: string;
  paymentTerms: string | null;
  deliveryDeadline: string | null;
  quantity: number;
  notes: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  jobId: string | null;
  jobProjectName: string | null;
};

export type JobOption = { id: string; label: string; finalPrice: string };

const initialState: QuoteFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-neutral-soft text-neutral",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

export function QuotePanel({
  opportunityId,
  quoteStatus,
  lostReason,
  versions,
  jobs,
}: {
  opportunityId: string;
  quoteStatus: QuoteStatus | null;
  lostReason: string | null;
  versions: QuoteVersionView[];
  jobs: JobOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"job" | "manual">(jobs.length > 0 ? "job" : "manual");
  const [jobState, jobFormAction, jobPending] = useActionState(createVersionFromJobAction, initialState);
  const [manualState, manualFormAction, manualPending] = useActionState(
    createManualVersionAction,
    initialState,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function handleSend(versionId: string) {
    setActionError(null);
    setPendingAction(versionId);
    const result = await sendQuoteVersionAction(versionId, opportunityId);
    setPendingAction(null);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleApprove(versionId: string) {
    setActionError(null);
    setPendingAction(versionId);
    const result = await approveQuoteVersionAction(versionId, opportunityId);
    setPendingAction(null);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleReject(versionId: string) {
    const reason = window.prompt("Motivo da rejeição/perda do orçamento (obrigatório):");
    if (!reason || !reason.trim()) return;
    setActionError(null);
    setPendingAction(versionId);
    const result = await rejectQuoteVersionAction(versionId, opportunityId, reason.trim());
    setPendingAction(null);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Orçamento</h2>
        {quoteStatus && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[QUOTE_STATUS_TONE[quoteStatus]]}`}
          >
            {QUOTE_STATUS_LABEL[quoteStatus]}
          </span>
        )}
      </div>

      {lostReason && (
        <p className="mt-2 rounded-sm bg-danger-soft px-3 py-2 text-xs text-danger">
          Motivo de perda: {lostReason}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-3 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {versions.length === 0 && <p className="text-sm text-text-muted">Nenhuma versão de orçamento ainda.</p>}
        {versions.map((v) => (
          <div key={v.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">
                Versão {v.versionNumber}
                {v.isManual ? " · manual" : ""}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[QUOTE_STATUS_TONE[v.status]]}`}
              >
                {QUOTE_STATUS_LABEL[v.status]}
              </span>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
              <Row label="Valor original" value={formatCurrency(v.originalValue)} />
              <Row label="Desconto" value={formatCurrency(v.discount)} />
              <Row label="Valor final" value={formatCurrency(v.finalValue)} />
              <Row label="Quantidade" value={String(v.quantity)} />
              <Row label="Condição de pagamento" value={v.paymentTerms ?? "—"} />
              <Row
                label="Prazo de entrega"
                value={v.deliveryDeadline ? new Date(v.deliveryDeadline).toLocaleDateString("pt-BR") : "—"}
              />
              {v.isManual && <Row label="Justificativa" value={v.manualJustification ?? "—"} />}
              {v.jobProjectName && <Row label="Origem" value={`Job — ${v.jobProjectName}`} />}
              {v.notes && <Row label="Observações" value={v.notes} />}
              <Row label="Criada em" value={new Date(v.createdAt).toLocaleString("pt-BR")} />
              {v.sentAt && <Row label="Enviada em" value={new Date(v.sentAt).toLocaleString("pt-BR")} />}
              {v.acceptedAt && <Row label="Aceite em" value={new Date(v.acceptedAt).toLocaleString("pt-BR")} />}
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              {v.status === "DRAFT" && (
                <button
                  type="button"
                  onClick={() => handleSend(v.id)}
                  disabled={pendingAction === v.id}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  Marcar como enviado
                </button>
              )}
              {(v.status === "DRAFT" || v.status === "SENT") && (
                <>
                  <button
                    type="button"
                    onClick={() => handleApprove(v.id)}
                    disabled={pendingAction === v.id}
                    className="rounded-sm bg-success px-2 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(v.id)}
                    disabled={pendingAction === v.id}
                    className="rounded-sm border border-danger px-2 py-1 text-xs text-danger transition hover:bg-danger-soft disabled:opacity-60"
                  >
                    Rejeitar
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-text">Nova versão</h3>
        <p className="mt-1 text-xs text-text-muted">
          Criar uma nova versão nunca sobrescreve uma versão já aprovada — ela continua intacta no histórico
          acima.
        </p>

        <div className="mt-3 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("job")}
            className={`rounded-sm px-2 py-1 ${mode === "job" ? "bg-accent text-white" : "border border-border text-text-muted"}`}
          >
            A partir de um job calculado
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-sm px-2 py-1 ${mode === "manual" ? "bg-accent text-white" : "border border-border text-text-muted"}`}
          >
            Manual (com justificativa)
          </button>
        </div>

        {mode === "job" ? (
          <form action={jobFormAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <select name="jobId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Selecione o job calculado
              </option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label} — {formatCurrency(j.finalPrice)}
                </option>
              ))}
            </select>
            {jobs.length === 0 && (
              <p className="text-xs text-text-faint">
                Nenhum job calculado ainda — crie um na calculadora primeiro, ou use um orçamento manual.
              </p>
            )}
            <CommonFields />
            {jobState?.error && <FormError message={jobState.error} />}
            <SubmitButton pending={jobPending} label="Gerar versão a partir do job" />
          </form>
        ) : (
          <form action={manualFormAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <input
              name="originalValue"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Valor original (R$)"
              required
              className={inputClass}
            />
            <textarea
              name="manualJustification"
              placeholder="Justificativa do orçamento manual (obrigatória)"
              required
              rows={2}
              className={inputClass}
            />
            <CommonFields />
            {manualState?.error && <FormError message={manualState.error} />}
            <SubmitButton pending={manualPending} label="Criar versão manual" />
          </form>
        )}
      </div>
    </section>
  );
}

function CommonFields() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input name="discount" type="number" step="0.01" min="0" placeholder="Desconto (R$)" className={inputClass} />
      <input name="quantity" type="number" step="1" min="1" placeholder="Quantidade" className={inputClass} />
      <input name="paymentTerms" placeholder="Condição de pagamento" className={inputClass} />
      <input name="deliveryDeadline" type="date" className={inputClass} />
      <input name="notes" placeholder="Observações" className={inputClass + " sm:col-span-2"} />
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
