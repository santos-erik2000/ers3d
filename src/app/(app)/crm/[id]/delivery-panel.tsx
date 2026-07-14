"use client";

import { useActionState } from "react";
import {
  createDeliveryAction,
  markDeliveryAsDeliveredAction,
  markDeliveryAsShippedAction,
  updateDeliveryAction,
  type DeliveryFormState,
} from "@/modules/deliveries/actions";
import { DELIVERY_METHOD_LABEL, DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from "@/modules/deliveries/format";
import type { DeliveryMethod, DeliveryStatus } from "@prisma/client";

export type DeliveryChecklistItemView = { id: string; label: string; checked: boolean; notes: string | null };

export type DeliveryView = {
  id: string;
  method: DeliveryMethod;
  status: DeliveryStatus;
  address: string | null;
  recipientName: string | null;
  trackingCode: string | null;
  expectedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  proofUrl: string | null;
  notes: string | null;
  checklistItems: DeliveryChecklistItemView[];
};

const initialState: DeliveryFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-neutral-soft text-neutral",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
};

const METHOD_OPTIONS: DeliveryMethod[] = ["RETIRADA", "ENTREGA_PROPRIA", "CORREIOS", "TRANSPORTADORA", "MOTOBOY"];

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/**
 * Painel de entrega da oportunidade (Sprint 8 — DEL-1/DEL-2): método,
 * rastreio, checklist de embalagem e status. Marcar como Entregue é o que
 * passa a alimentar a pré-condição real de Entrega → Concluído
 * (src/modules/crm/services/opportunities.ts, `validateTransition`, case
 * "ENTREGA").
 *
 * Limitação conhecida (documentada, não escondida): o schema permite mais de
 * uma Delivery por oportunidade (reenvio após extravio, por exemplo), mas
 * esta UI só mostra/edita a mais recente — criar uma nova Delivery quando já
 * existe uma (ex.: reenvio depois de uma tentativa com problema) não tem
 * formulário dedicado ainda; refinamento futuro.
 */
export function DeliveryPanel({
  opportunityId,
  canCreate,
  delivery,
}: {
  opportunityId: string;
  canCreate: boolean;
  delivery: DeliveryView | null;
}) {
  if (!delivery) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text">Entrega</h2>
        {canCreate ? (
          <CreateDeliveryForm opportunityId={opportunityId} />
        ) : (
          <p className="mt-2 text-xs text-text-muted">
            O registro de entrega fica disponível aqui quando a oportunidade está na etapa Entrega.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Entrega</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[DELIVERY_STATUS_TONE[delivery.status]]}`}>
          {DELIVERY_STATUS_LABEL[delivery.status]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Método" value={DELIVERY_METHOD_LABEL[delivery.method]} />
        <Row label="Responsável pelo recebimento" value={delivery.recipientName ?? "—"} />
        <Row label="Endereço" value={delivery.address ?? "—"} />
        <Row label="Rastreio" value={delivery.trackingCode ?? "—"} />
        <Row
          label="Prazo previsto"
          value={delivery.expectedAt ? new Date(delivery.expectedAt).toLocaleDateString("pt-BR") : "—"}
        />
        {delivery.shippedAt && (
          <Row label="Enviado em" value={new Date(delivery.shippedAt).toLocaleString("pt-BR")} />
        )}
        {delivery.deliveredAt && (
          <Row label="Entregue em" value={new Date(delivery.deliveredAt).toLocaleString("pt-BR")} />
        )}
        {delivery.proofUrl && (
          <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
            <dt className="text-text-muted">Comprovante</dt>
            <dd>
              <a href={delivery.proofUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                abrir
              </a>
            </dd>
          </div>
        )}
      </dl>

      {delivery.status !== "ENTREGUE" && (
        <>
          <UpdateDeliveryForm opportunityId={opportunityId} delivery={delivery} />
          <ShippingActions opportunityId={opportunityId} delivery={delivery} />
        </>
      )}
    </section>
  );
}

function CreateDeliveryForm({ opportunityId }: { opportunityId: string }) {
  const [state, formAction, pending] = useActionState(createDeliveryAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select name="method" defaultValue="RETIRADA" className={inputClass}>
          {METHOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {DELIVERY_METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <input name="recipientName" placeholder="Responsável pelo recebimento" className={inputClass} />
        <input name="address" placeholder="Endereço" className={inputClass + " sm:col-span-2"} />
        <input name="trackingCode" placeholder="Código de rastreio (opcional)" className={inputClass} />
        <input name="expectedAt" type="date" className={inputClass} />
        <textarea name="notes" placeholder="Observações" rows={2} className={inputClass + " sm:col-span-2"} />
      </div>
      {state?.error && <FormError message={state.error} />}
      <SubmitButton pending={pending} label="Registrar entrega" />
    </form>
  );
}

function UpdateDeliveryForm({ opportunityId, delivery }: { opportunityId: string; delivery: DeliveryView }) {
  const [state, formAction, pending] = useActionState(updateDeliveryAction, initialState);
  const checklistIds = delivery.checklistItems.map((i) => i.id).join(",");

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">Dados da entrega</h3>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="deliveryId" value={delivery.id} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input type="hidden" name="checklistIds" value={checklistIds} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select name="method" defaultValue={delivery.method} className={inputClass}>
            {METHOD_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {DELIVERY_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <input
            name="recipientName"
            defaultValue={delivery.recipientName ?? ""}
            placeholder="Responsável pelo recebimento"
            className={inputClass}
          />
          <input
            name="address"
            defaultValue={delivery.address ?? ""}
            placeholder="Endereço"
            className={inputClass + " sm:col-span-2"}
          />
          <input
            name="trackingCode"
            defaultValue={delivery.trackingCode ?? ""}
            placeholder="Código de rastreio"
            className={inputClass}
          />
          <input name="expectedAt" type="date" defaultValue={toDateInputValue(delivery.expectedAt)} className={inputClass} />
          <input
            name="proofUrl"
            defaultValue={delivery.proofUrl ?? ""}
            placeholder="URL do comprovante (opcional)"
            className={inputClass + " sm:col-span-2"}
          />
          <textarea
            name="notes"
            defaultValue={delivery.notes ?? ""}
            placeholder="Observações"
            rows={2}
            className={inputClass + " sm:col-span-2"}
          />
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-faint">Checklist de embalagem</h4>
          <ul className="mt-2 flex flex-col gap-2">
            {delivery.checklistItems.map((item) => (
              <li key={item.id} className="rounded-sm border border-border p-2">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    name={`checklist_${item.id}_checked`}
                    defaultChecked={item.checked}
                    className="h-4 w-4"
                  />
                  {item.label}
                </label>
                <input
                  name={`checklist_${item.id}_notes`}
                  defaultValue={item.notes ?? ""}
                  placeholder="Observação (opcional)"
                  className={inputClass + " mt-1 w-full"}
                />
              </li>
            ))}
          </ul>
        </div>

        {state?.error && <FormError message={state.error} />}
        <SubmitButton pending={pending} label="Salvar dados da entrega" />
      </form>
    </div>
  );
}

function ShippingActions({ opportunityId, delivery }: { opportunityId: string; delivery: DeliveryView }) {
  const [shipState, shipAction, shipPending] = useActionState(markDeliveryAsShippedAction, initialState);
  const [deliverState, deliverAction, deliverPending] = useActionState(markDeliveryAsDeliveredAction, initialState);

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-start sm:gap-6">
      {delivery.status === "PENDENTE" && (
        <form action={shipAction} className="flex flex-col gap-2">
          <input type="hidden" name="deliveryId" value={delivery.id} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <button
            type="submit"
            disabled={shipPending}
            className="rounded-sm border border-border px-3 py-2 text-sm text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {shipPending ? "Salvando…" : "Marcar como enviado"}
          </button>
          {shipState?.error && <FormError message={shipState.error} />}
        </form>
      )}

      <form action={deliverAction} className="flex flex-col gap-2">
        <input type="hidden" name="deliveryId" value={delivery.id} />
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <input name="proofUrl" placeholder="URL do comprovante (opcional)" className={inputClass} />
        <button
          type="submit"
          disabled={deliverPending}
          className="w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          {deliverPending ? "Salvando…" : "Marcar como entregue"}
        </button>
        {deliverState?.error && <FormError message={deliverState.error} />}
      </form>
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
