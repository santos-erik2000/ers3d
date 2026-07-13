"use client";

import { useActionState } from "react";
import { createUserAction } from "@/modules/auth/actions";

export function NewUserForm({ roles }: { roles: { slug: string; name: string }[] }) {
  const [error, formAction, isPending] = useActionState(createUserAction, undefined);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input
        name="name"
        placeholder="Nome"
        required
        className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
      />
      <input
        name="email"
        type="email"
        placeholder="E-mail"
        required
        className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
      />
      <input
        name="password"
        type="password"
        placeholder="Senha temporária (mín. 8 caracteres)"
        required
        minLength={8}
        className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
      />
      <select
        name="roleSlug"
        required
        defaultValue=""
        className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
      >
        <option value="" disabled>
          Selecione o perfil
        </option>
        {roles.map((role) => (
          <option key={role.slug} value={role.slug}>
            {role.name}
          </option>
        ))}
      </select>

      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {isPending ? "Criando…" : "Criar usuário"}
      </button>
    </form>
  );
}
