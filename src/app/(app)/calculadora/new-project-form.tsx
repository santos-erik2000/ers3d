"use client";

import { useActionState } from "react";
import { createProjectAction, type ProjectFormState } from "@/modules/jobs/actions";

const initialState: ProjectFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function NewProjectForm({
  customers,
  users,
}: {
  customers: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createProjectAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nome do projeto" required className={inputClass + " sm:col-span-2"} />

        <select name="customerId" defaultValue="" className={inputClass}>
          <option value="">Sem cliente vinculado</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input name="category" placeholder="Categoria" className={inputClass} />

        <select name="responsibleId" defaultValue="" className={inputClass}>
          <option value="">Sem responsável definido</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        <select name="status" defaultValue="PLANEJAMENTO" className={inputClass}>
          <option value="PLANEJAMENTO">Planejamento</option>
          <option value="EM_ANDAMENTO">Em andamento</option>
          <option value="CONCLUIDO">Concluído</option>
          <option value="CANCELADO">Cancelado</option>
        </select>
      </div>

      <textarea name="description" placeholder="Descrição" rows={2} className={inputClass} />

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
        {isPending ? "Criando…" : "Criar projeto"}
      </button>
    </form>
  );
}
