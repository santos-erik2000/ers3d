"use client";

import { useActionState, useState } from "react";
import { createJobAction, type JobFormState } from "@/modules/jobs/actions";
import { formatCurrency, formatPercent } from "@/modules/jobs/format";

const initialState: JobFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

type FilamentRow = { key: number; filamentId: string; grams: string };

let rowKeySeq = 0;
function newRow(): FilamentRow {
  rowKeySeq += 1;
  return { key: rowKeySeq, filamentId: "", grams: "" };
}

export function NewJobForm({
  projects,
  filaments,
}: {
  projects: { id: string; name: string }[];
  filaments: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createJobAction, initialState);
  const [rows, setRows] = useState<FilamentRow[]>([newRow()]);

  function updateRow(key: number, patch: Partial<FilamentRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const job = state && "job" in state ? state.job : undefined;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select name="projectId" required defaultValue="" className={inputClass + " sm:col-span-2"}>
          <option value="" disabled>
            Selecione o projeto
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <input name="powerWatts" type="number" step="0.01" min="0" placeholder="Potência (W)" required className={inputClass} />
        <input name="printHours" type="number" step="0.01" min="0" placeholder="Horas de impressão" required className={inputClass} />
        <input name="kwhPrice" type="number" step="0.0001" min="0" placeholder="Preço do kWh (R$)" required className={inputClass} />
        <input
          name="quantityProduced"
          type="number"
          step="1"
          min="1"
          defaultValue="1"
          placeholder="Quantidade produzida"
          className={inputClass}
        />

        <input
          name="maintenancePct"
          type="number"
          step="0.01"
          min="0"
          max="99.99"
          placeholder="Manutenção (%) — ex.: 10"
          required
          className={inputClass}
        />
        <input
          name="safetyPct"
          type="number"
          step="0.01"
          min="0"
          max="99.99"
          placeholder="Segurança (%) — ex.: 5"
          required
          className={inputClass}
        />
        <input
          name="profitPct"
          type="number"
          step="0.01"
          min="0"
          max="99.99"
          placeholder="Lucro (%) — ex.: 30"
          required
          className={inputClass}
        />
      </div>

      <div className="rounded-sm border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Filamentos utilizados</p>
        <input type="hidden" name="filamentRows" value={rows.length} />
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto]">
              <select
                name={`filaments.${index}.filamentId`}
                value={row.filamentId}
                onChange={(e) => updateRow(row.key, { filamentId: e.target.value })}
                required
                className={inputClass}
              >
                <option value="">Selecione o filamento</option>
                {filaments.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <input
                name={`filaments.${index}.grams`}
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Gramas"
                value={row.grams}
                onChange={(e) => updateRow(row.key, { grams: e.target.value })}
                required
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                disabled={rows.length === 1}
                className="rounded-sm border border-border px-3 py-2 text-xs text-text-muted hover:bg-surface-alt disabled:opacity-40"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="mt-2 w-fit rounded-sm border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          + Adicionar filamento
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {isPending ? "Calculando…" : "Calcular preço"}
      </button>

      {job && (
        <div className="mt-2 rounded-sm border border-success bg-success-soft p-4 text-sm text-text">
          <p className="font-semibold text-success">
            Job calculado — projeto {job.projectName} (regra {job.ruleVersion})
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            <dt className="text-text-muted">Custo filamentos</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.filamentsCost)}</dd>
            <dt className="text-text-muted">Custo energia</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.energyCost)}</dd>
            <dt className="text-text-muted">Custo direto</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.directCost)}</dd>
            <dt className="text-text-muted">Manutenção ({formatPercent(job.maintenancePct)})</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.maintenanceValue)}</dd>
            <dt className="text-text-muted">Segurança ({formatPercent(job.safetyPct)})</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.safetyValue)}</dd>
            <dt className="text-text-muted">Lucro ({formatPercent(job.profitPct)})</dt>
            <dd className="col-span-1 sm:col-span-2">{formatCurrency(job.profitValue)}</dd>
            <dt className="font-semibold text-text">Preço final</dt>
            <dd className="col-span-1 font-semibold sm:col-span-2">{formatCurrency(job.finalPrice)}</dd>
          </dl>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Por filamento</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">
            {job.filaments.map((f) => (
              <li key={f.filamentId}>
                {f.filamentName} — {f.gramsUsed} g × {formatCurrency(f.pricePerKgAtTime)}/kg ={" "}
                {formatCurrency(f.costCalculated)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
