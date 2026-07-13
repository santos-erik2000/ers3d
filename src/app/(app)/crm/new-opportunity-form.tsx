"use client";

import { useActionState } from "react";
import { createOpportunityAction, type OpportunityFormState } from "@/modules/crm/actions";

const initialState: OpportunityFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function NewOpportunityForm({
  customers,
  owners,
}: {
  customers: { id: string; name: string }[];
  owners: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createOpportunityAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="title" placeholder="Nome do projeto/oportunidade" required className={inputClass} />

        <select name="customerId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecione o cliente
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          name="value"
          type="number"
          step="0.01"
          min="0"
          placeholder="Valor negociado (R$)"
          className={inputClass}
        />

        <input name="deadlineAt" type="date" className={inputClass} />

        <select name="ownerId" defaultValue="" className={inputClass}>
          <option value="">Sem responsável definido</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>

        <select name="priority" defaultValue="MEDIUM" className={inputClass}>
          <option value="LOW">Prioridade baixa</option>
          <option value="MEDIUM">Prioridade média</option>
          <option value="HIGH">Prioridade alta</option>
        </select>

        <input
          name="tags"
          placeholder="Tags (separadas por vírgula)"
          className={inputClass + " sm:col-span-2"}
        />
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
        {isPending ? "Criando…" : "Criar oportunidade"}
      </button>
    </form>
  );
}
