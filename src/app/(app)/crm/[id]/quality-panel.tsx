"use client";

import { useActionState, useState } from "react";
import { submitQualityCheckAction, type QualityFormState } from "@/modules/quality/actions";
import { QUALITY_CHECKLIST_ITEMS, QUALITY_RESULT_LABEL, QUALITY_RESULT_TONE } from "@/modules/quality/format";
import type { QualityCheckResult } from "@prisma/client";

export type QualityCheckItemView = {
  id: string;
  label: string;
  passed: boolean;
  notes: string | null;
  evidencePhotoUrl: string | null;
};

export type QualityCheckView = {
  id: string;
  result: QualityCheckResult;
  rejectionReason: string | null;
  checkedAt: string;
  checkedByName: string | null;
  items: QualityCheckItemView[];
};

const initialState: QualityFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const TONE_CLASS: Record<string, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const RESULT_OPTIONS: QualityCheckResult[] = ["APROVADO", "APROVADO_COM_RESSALVA", "REPROVADO"];

/**
 * Painel de qualidade da oportunidade (Sprint 7 — QUAL-1/QUAL-2/QUAL-3):
 * formulário do checklist (quando aplicável) + histórico completo, incluindo
 * reprovações antigas, que nunca desaparece mesmo depois de um retrabalho
 * seguinte ser aprovado.
 *
 * A reprovação de qualidade agora só acontece por aqui — o quadro Kanban
 * (/crm) não oferece mais o atalho de arrastar o card de volta de Qualidade
 * para Desenvolvimento, exatamente para que toda reprovação sempre gere o
 * registro do checklist + o novo ciclo de retrabalho (ver crm-board.tsx).
 */
export function QualityPanel({
  opportunityId,
  canSubmit,
  productionOrderId,
  history,
}: {
  opportunityId: string;
  canSubmit: boolean;
  productionOrderId: string | null;
  history: QualityCheckView[];
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text">Qualidade</h2>

      {canSubmit && productionOrderId ? (
        <QualityCheckForm opportunityId={opportunityId} productionOrderId={productionOrderId} />
      ) : (
        <p className="mt-2 text-xs text-text-muted">
          O checklist de qualidade fica disponível aqui quando a oportunidade está na etapa Teste de Qualidade
          com a ordem de produção mais recente concluída.
        </p>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">Histórico de qualidade</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-text-faint">Nenhum checklist registrado ainda.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {history.map((check) => (
              <li key={check.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[QUALITY_RESULT_TONE[check.result]]}`}
                  >
                    {QUALITY_RESULT_LABEL[check.result]}
                  </span>
                  <span className="text-xs text-text-faint">
                    {new Date(check.checkedAt).toLocaleString("pt-BR")} · {check.checkedByName ?? "—"}
                  </span>
                </div>

                {check.rejectionReason && (
                  <p className="mt-2 text-xs text-danger">Motivo da reprovação: {check.rejectionReason}</p>
                )}

                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {check.items.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <span className={item.passed ? "font-medium text-success" : "font-medium text-danger"}>
                        {item.passed ? "OK" : "Falhou"}
                      </span>
                      <span className="text-text-muted">
                        {item.label}
                        {item.notes ? ` — ${item.notes}` : ""}
                        {item.evidencePhotoUrl ? (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={item.evidencePhotoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              evidência
                            </a>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QualityCheckForm({
  opportunityId,
  productionOrderId,
}: {
  opportunityId: string;
  productionOrderId: string;
}) {
  const [state, formAction, pending] = useActionState(submitQualityCheckAction, initialState);
  const [result, setResult] = useState<QualityCheckResult>("APROVADO");

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-4">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="productionOrderId" value={productionOrderId} />

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">Checklist</h3>
        {QUALITY_CHECKLIST_ITEMS.map((label, index) => (
          <div key={label} className="rounded-sm border border-border p-2">
            <input type="hidden" name={`item_${index}_label`} value={label} />
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" name={`item_${index}_passed`} defaultChecked className="h-4 w-4" />
              {label}
            </label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                name={`item_${index}_notes`}
                placeholder="Observação (opcional)"
                className={inputClass}
              />
              <input
                name={`item_${index}_evidence`}
                placeholder="URL da evidência fotográfica (opcional)"
                className={inputClass}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-muted">Resultado</label>
        <select
          name="result"
          value={result}
          onChange={(e) => setResult(e.target.value as QualityCheckResult)}
          className={inputClass}
        >
          {RESULT_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {QUALITY_RESULT_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      {result === "REPROVADO" && (
        <div className="flex flex-col gap-1 rounded-sm bg-danger-soft p-3">
          <label className="text-xs font-medium text-danger">Motivo da reprovação (obrigatório)</label>
          <textarea name="rejectionReason" required rows={2} className={inputClass} />
          <p className="text-xs text-danger">
            Ao reprovar, a oportunidade volta automaticamente para Desenvolvimento e uma nova ordem de produção
            é aberta para retrabalho — esta reprovação continua visível no histórico depois, mesmo que o
            retrabalho seja aprovado.
          </p>
        </div>
      )}

      {state?.error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Registrando…" : "Registrar checklist"}
      </button>
    </form>
  );
}
