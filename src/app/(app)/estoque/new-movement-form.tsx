"use client";

import { useActionState, useState } from "react";
import { recordMovementAction, type MovementFormState } from "@/modules/filaments/actions";
import { FIXED_SIGN_MOVEMENT_TYPES, MOVEMENT_TYPE_LABEL } from "@/modules/filaments/format";
import type { FilamentMovementType } from "@prisma/client";

const initialState: MovementFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const MOVEMENT_TYPES: FilamentMovementType[] = ["ENTRADA", "AJUSTE", "PERDA", "DEVOLUCAO", "CORRECAO"];

export function NewMovementForm({ filaments }: { filaments: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(recordMovementAction, initialState);
  const [type, setType] = useState<FilamentMovementType>("ENTRADA");

  const isFixedSign = FIXED_SIGN_MOVEMENT_TYPES.includes(type);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select name="filamentId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecione o filamento
          </option>
          {filaments.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as FilamentMovementType)}
          className={inputClass}
        >
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>

        <input
          name="quantityGrams"
          type="number"
          step="0.01"
          min={isFixedSign ? "0.01" : undefined}
          placeholder={isFixedSign ? "Quantidade (g)" : "Delta (g) — use negativo para reduzir"}
          required
          className={inputClass}
        />

        <input name="reason" placeholder="Motivo (opcional para Entrada/Devolução)" className={inputClass} />
      </div>

      <p className="text-xs text-text-muted">
        {isFixedSign
          ? `${MOVEMENT_TYPE_LABEL[type]} sempre ${type === "PERDA" ? "reduz" : "aumenta"} o saldo — informe a quantidade em gramas (sempre positiva).`
          : "Ajuste/Correção aceitam um valor negativo (ex.: -15) para reduzir o saldo, ou positivo para aumentar."}
      </p>

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
        {isPending ? "Registrando…" : "Registrar movimentação"}
      </button>
    </form>
  );
}
