"use client";

import { useActionState, useState } from "react";
import { recordInventoryMovementAction, type InventoryFormState } from "@/modules/inventory/actions";
import { formatCurrency, INVENTORY_STATUS_LABEL } from "@/modules/inventory/format";
import type { InventoryItemStatus } from "@prisma/client";

export type InventoryItemView = {
  id: string;
  quantityProduced: number;
  quantityAvailable: number;
  quantityReserved: number;
  quantitySold: number;
  quantityDiscarded: number;
  unitCost: string | null;
  status: InventoryItemStatus;
  createdAt: string;
};

const initialState: InventoryFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const OPERATION_LABEL: Record<string, string> = {
  RESERVAR: "Reservar",
  LIBERAR: "Liberar reserva",
  VENDER: "Vender",
  DESCARTAR: "Descartar",
  AJUSTAR: "Ajustar (com justificativa)",
};

/**
 * Painel de estoque de peças da oportunidade (Sprint 8 — INV-1/INV-2): uma
 * peça em estoque é gerada automaticamente quando um checklist de qualidade é
 * aprovado (ou aprovado com ressalva) — ver
 * src/modules/quality/services/quality.ts. Aqui só é possível operar sobre
 * itens já existentes; não há criação manual (isso quebraria a rastreabilidade
 * INV-1 de "de onde veio esta peça").
 */
export function InventoryPanel({
  opportunityId,
  items,
}: {
  opportunityId: string;
  items: InventoryItemView[];
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text">Estoque de peças</h2>

      {items.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          Nenhuma peça em estoque ainda — é gerada automaticamente quando um checklist de qualidade desta
          oportunidade é aprovado (ou aprovado com ressalva).
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {items.map((item) => (
            <InventoryItemCard key={item.id} opportunityId={opportunityId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InventoryItemCard({ opportunityId, item }: { opportunityId: string; item: InventoryItemView }) {
  const [state, formAction, pending] = useActionState(recordInventoryMovementAction, initialState);
  const [operation, setOperation] = useState("VENDER");

  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs font-medium text-neutral">
          {INVENTORY_STATUS_LABEL[item.status]}
        </span>
        <span className="text-xs text-text-faint">
          Criado em {new Date(item.createdAt).toLocaleString("pt-BR")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        <Stat label="Produzido" value={item.quantityProduced} />
        <Stat label="Disponível" value={item.quantityAvailable} highlight />
        <Stat label="Reservado" value={item.quantityReserved} />
        <Stat label="Vendido" value={item.quantitySold} />
        <Stat label="Descartado" value={item.quantityDiscarded} />
      </dl>
      {item.unitCost && (
        <p className="mt-2 text-xs text-text-muted">Custo unitário estimado: {formatCurrency(item.unitCost)}</p>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="inventoryItemId" value={item.id} />
        <input type="hidden" name="opportunityId" value={opportunityId} />

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">Operação</label>
          <select
            name="operation"
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
            className={inputClass}
          >
            {Object.entries(OPERATION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted">
            {operation === "AJUSTAR" ? "Delta (pode ser negativo)" : "Quantidade"}
          </label>
          <input name="quantity" type="number" step="1" required className={inputClass + " w-28"} />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-text-muted">
            {operation === "AJUSTAR" ? "Justificativa (obrigatória)" : "Observação (opcional)"}
          </label>
          <input
            name="reason"
            required={operation === "AJUSTAR"}
            className={inputClass}
            placeholder={operation === "AJUSTAR" ? "Motivo do ajuste" : "Opcional"}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Registrar"}
        </button>
      </form>

      {state?.error && (
        <p role="alert" className="mt-2 rounded-sm bg-danger-soft px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      )}
    </li>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-text-faint">{label}</dt>
      <dd className={highlight ? "font-semibold text-text" : "text-text-muted"}>{value}</dd>
    </div>
  );
}
