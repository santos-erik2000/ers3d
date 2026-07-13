"use client";

import { useActionState } from "react";
import { createFilamentAction, type FilamentFormState } from "@/modules/filaments/actions";

const initialState: FilamentFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function NewFilamentForm() {
  const [state, formAction, isPending] = useActionState(createFilamentAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nome" required className={inputClass} />
        <input name="material" placeholder="Material (ex.: PLA, PETG, ABS)" required className={inputClass} />
        <input name="brand" placeholder="Marca" className={inputClass} />
        <input name="color" placeholder="Cor" className={inputClass} />
        <input name="batch" placeholder="Lote" className={inputClass} />
        <input name="supplier" placeholder="Fornecedor" className={inputClass} />
        <input
          name="pricePerKg"
          type="number"
          step="0.01"
          min="0"
          placeholder="Preço por kg (R$)"
          required
          className={inputClass}
        />
        <input
          name="initialWeightGrams"
          type="number"
          step="0.01"
          min="0"
          placeholder="Peso inicial (g)"
          required
          className={inputClass}
        />
        <input
          name="availableGrams"
          type="number"
          step="0.01"
          min="0"
          placeholder="Gramas disponíveis agora (g)"
          required
          className={inputClass}
        />
        <input
          name="minStockGrams"
          type="number"
          step="0.01"
          min="0"
          placeholder="Estoque mínimo (g)"
          required
          className={inputClass}
        />
        <input name="purchaseDate" type="date" className={inputClass} />
        <input name="location" placeholder="Localização" className={inputClass} />
        <select name="status" defaultValue="ACTIVE" className={inputClass}>
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
      </div>
      <textarea name="notes" placeholder="Observações" rows={3} className={inputClass} />

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
        {isPending ? "Salvando…" : "Cadastrar filamento"}
      </button>
    </form>
  );
}
