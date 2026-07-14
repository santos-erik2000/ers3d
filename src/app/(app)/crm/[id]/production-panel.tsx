"use client";

import { useActionState, useState } from "react";
import {
  completeProductionAction,
  createManualProductionOrderAction,
  updateProductionOrderAction,
  type ProductionFormState,
} from "@/modules/production/actions";
import {
  PRINT_STATUS_LABEL,
  PRINT_STATUS_TONE,
  getProductionDeadlineStatus,
} from "@/modules/production/format";
import type { ProductionPrintStatus } from "@prisma/client";

export type ProductionFilamentView = {
  filamentId: string;
  filamentName: string;
  gramsUsed: string;
  gramsActual: string | null;
};

export type ProductionOrderView = {
  id: string;
  printStatus: ProductionPrintStatus;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualHours: string | null;
  technicalNotes: string | null;
  completedAt: string | null;
  printerId: string | null;
  printerName: string | null;
  responsibleId: string | null;
  responsibleName: string | null;
  jobId: string | null;
  filaments: ProductionFilamentView[];
};

export type SelectOption = { id: string; name: string };

const initialState: ProductionFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-neutral-soft text-neutral",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

const MANUAL_STATUS_OPTIONS: ProductionPrintStatus[] = ["AGUARDANDO", "IMPRIMINDO", "FALHOU"];

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ProductionPanel({
  opportunityId,
  order,
  printers,
  responsibles,
}: {
  opportunityId: string;
  order: ProductionOrderView | null;
  printers: SelectOption[];
  responsibles: SelectOption[];
}) {
  if (!order) {
    return (
      <CreateManualOrderCard opportunityId={opportunityId} printers={printers} responsibles={responsibles} />
    );
  }

  const deadline = getProductionDeadlineStatus(order.plannedEndAt, order.printStatus);

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Produção</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[PRINT_STATUS_TONE[order.printStatus]]}`}>
          {PRINT_STATUS_LABEL[order.printStatus]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Impressora" value={order.printerName ?? "—"} />
        <Row label="Responsável" value={order.responsibleName ?? "—"} />
        <Row label="Início previsto" value={order.plannedStartAt ? new Date(order.plannedStartAt).toLocaleDateString("pt-BR") : "—"} />
        <Row label="Término previsto" value={order.plannedEndAt ? new Date(order.plannedEndAt).toLocaleDateString("pt-BR") : "—"} />
        <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
          <dt className="text-text-muted">Prazo</dt>
          <dd>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[deadline.tone]}`}>
              {deadline.label}
            </span>
          </dd>
        </div>
        {order.actualHours && <Row label="Horas reais" value={order.actualHours} />}
        {order.completedAt && (
          <Row label="Concluída em" value={new Date(order.completedAt).toLocaleString("pt-BR")} />
        )}
        {order.technicalNotes && <Row label="Observações técnicas" value={order.technicalNotes} />}
      </dl>

      {order.jobId && order.filaments.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">
            Material previsto (job vinculado)
          </h3>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-text-faint">
                <th className="pb-1 font-normal">Filamento</th>
                <th className="pb-1 font-normal">Reservado (g)</th>
                <th className="pb-1 font-normal">Real (g)</th>
              </tr>
            </thead>
            <tbody>
              {order.filaments.map((f) => (
                <tr key={f.filamentId} className="border-t border-border">
                  <td className="py-1 text-text">{f.filamentName}</td>
                  <td className="py-1 text-text-muted">{f.gramsUsed}</td>
                  <td className="py-1 text-text-muted">{f.gramsActual ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {order.printStatus !== "CONCLUIDA" && (
        <>
          <UpdateDetailsForm
            opportunityId={opportunityId}
            order={order}
            printers={printers}
            responsibles={responsibles}
          />
          <CompleteProductionForm opportunityId={opportunityId} order={order} />
        </>
      )}
    </section>
  );
}

function CreateManualOrderCard({
  opportunityId,
  printers,
  responsibles,
}: {
  opportunityId: string;
  printers: SelectOption[];
  responsibles: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(createManualProductionOrderAction, initialState);

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text">Produção</h2>
      <p className="mt-1 text-xs text-text-muted">
        Nenhuma ordem de produção ainda. Se o orçamento aprovado veio de um job calculado, a ordem é criada
        automaticamente (com reserva do filamento estimado) no momento da aprovação — se ainda não apareceu
        aqui, aprove uma versão de orçamento primeiro. Se o orçamento aprovado foi manual (sem job), crie a
        ordem manualmente abaixo — sem reserva automática de estoque.
      </p>

      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select name="printerId" defaultValue="" className={inputClass}>
            <option value="">Sem impressora definida</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="responsibleId" defaultValue="" className={inputClass}>
            <option value="">Sem responsável definido</option>
            {responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input name="plannedStartAt" type="date" className={inputClass} />
          <input name="plannedEndAt" type="date" className={inputClass} />
          <textarea
            name="technicalNotes"
            placeholder="Observações técnicas"
            rows={2}
            className={inputClass + " sm:col-span-2"}
          />
        </div>
        {state?.error && <FormError message={state.error} />}
        <SubmitButton pending={pending} label="Criar ordem de produção manual" />
      </form>
    </section>
  );
}

function UpdateDetailsForm({
  opportunityId,
  order,
  printers,
  responsibles,
}: {
  opportunityId: string;
  order: ProductionOrderView;
  printers: SelectOption[];
  responsibles: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(updateProductionOrderAction, initialState);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">Dados técnicos</h3>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select name="printerId" defaultValue={order.printerId ?? ""} className={inputClass}>
            <option value="">Sem impressora definida</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select name="responsibleId" defaultValue={order.responsibleId ?? ""} className={inputClass}>
            <option value="">Sem responsável definido</option>
            {responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            name="plannedStartAt"
            type="date"
            defaultValue={toDateInputValue(order.plannedStartAt)}
            className={inputClass}
          />
          <input
            name="plannedEndAt"
            type="date"
            defaultValue={toDateInputValue(order.plannedEndAt)}
            className={inputClass}
          />
          <select name="printStatus" defaultValue={order.printStatus} className={inputClass}>
            {MANUAL_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PRINT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <textarea
            name="technicalNotes"
            placeholder="Observações técnicas"
            defaultValue={order.technicalNotes ?? ""}
            rows={2}
            className={inputClass + " sm:col-span-2"}
          />
        </div>
        {state?.error && <FormError message={state.error} />}
        <SubmitButton pending={pending} label="Salvar dados técnicos" />
      </form>
    </div>
  );
}

function CompleteProductionForm({
  opportunityId,
  order,
}: {
  opportunityId: string;
  order: ProductionOrderView;
}) {
  const [state, formAction, pending] = useActionState(completeProductionAction, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">Concluir produção</h3>
      <p className="mt-1 text-xs text-text-muted">
        Aponte as horas reais de impressão{order.jobId ? " e as gramas reais de cada filamento" : ""}.
        {order.jobId
          ? " Gramas a mais consomem a diferença do estoque disponível (falha se não houver saldo); gramas a menos liberam a diferença de volta."
          : " Esta ordem não tem job vinculado — não há reserva de filamento para reconciliar."}
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-sm border border-border px-3 py-2 text-sm text-text-muted transition hover:border-accent hover:text-accent"
        >
          Registrar conclusão
        </button>
      ) : (
        <form action={formAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="opportunityId" value={opportunityId} />

          <input
            name="actualHours"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Horas reais de impressão"
            required
            className={inputClass}
          />

          {order.jobId && order.filaments.length > 0 && (
            <div className="flex flex-col gap-2">
              {order.filaments.map((f) => (
                <div key={f.filamentId} className="flex items-center gap-2">
                  <label className="w-40 shrink-0 text-xs text-text-muted">{f.filamentName}</label>
                  <input
                    name={`actualGrams_${f.filamentId}`}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={f.gramsUsed}
                    placeholder={`Estimado: ${f.gramsUsed}g`}
                    required
                    className={inputClass + " flex-1"}
                  />
                </div>
              ))}
            </div>
          )}

          <textarea
            name="technicalNotes"
            placeholder="Falhas/observações da produção"
            rows={2}
            className={inputClass}
          />

          {state?.error && <FormError message={state.error} />}
          <div className="flex gap-2">
            <SubmitButton pending={pending} label="Confirmar conclusão" />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-sm border border-border px-3 py-2 text-sm text-text-muted transition hover:border-danger hover:text-danger"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
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
    <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}
