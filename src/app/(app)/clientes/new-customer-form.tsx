"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createCustomerAction, type CustomerFormState } from "@/modules/customers/actions";

const initialState: CustomerFormState = undefined;

const inputClass =
  "rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

const DUPLICATE_FIELD_LABEL: Record<string, string> = {
  email: "e-mail",
  phone: "telefone",
  document: "CPF/CNPJ",
};

export function NewCustomerForm({ owners }: { owners: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createCustomerAction, initialState);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const duplicates = state?.duplicates ?? [];
  const hasDuplicates = duplicates.length > 0;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nome" required className={inputClass} />
        <select name="type" required defaultValue="PF" className={inputClass}>
          <option value="PF">Pessoa física</option>
          <option value="PJ">Pessoa jurídica</option>
        </select>
        <input name="document" placeholder="CPF/CNPJ" className={inputClass} />
        <input name="email" type="email" placeholder="E-mail" className={inputClass} />
        <input name="phone" placeholder="Telefone" className={inputClass} />
        <input name="whatsapp" placeholder="WhatsApp" className={inputClass} />
        <input name="address" placeholder="Endereço" className={inputClass} />
        <input name="city" placeholder="Cidade" className={inputClass} />
        <input name="state" placeholder="UF" maxLength={2} className={inputClass} />
        <input name="zipCode" placeholder="CEP" className={inputClass} />
        <input name="origin" placeholder="Origem (ex.: indicação, site, Instagram)" className={inputClass} />
        <input name="segment" placeholder="Segmento" className={inputClass} />
        <input name="companyName" placeholder="Empresa (tag opcional)" className={inputClass} />
        <select name="ownerId" defaultValue="" className={inputClass}>
          <option value="">Sem responsável definido</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
        <input name="tags" placeholder="Tags (separadas por vírgula)" className={inputClass} />
      </div>
      <textarea name="notes" placeholder="Observações" rows={3} className={inputClass} />

      <input type="hidden" name="confirmedDuplicate" value={confirmDuplicate ? "true" : "false"} />

      {state?.error && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      {hasDuplicates && (
        <div
          role="alert"
          className="rounded-sm border border-warning bg-warning-soft px-3 py-3 text-sm text-warning"
        >
          <p className="font-semibold">Possível cliente duplicado</p>
          <p className="mt-1">
            Encontramos {duplicates.length === 1 ? "um cadastro" : "cadastros"} com dados coincidentes.
            Confira antes de continuar — pode ser o mesmo cliente:
          </p>
          <ul className="mt-2 list-disc pl-5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/clientes/${d.id}`} className="underline" target="_blank">
                  {d.name}
                </Link>{" "}
                — mesmo {d.matchedFields.map((f) => DUPLICATE_FIELD_LABEL[f] ?? f).join(", ")}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-warning">
            <input
              type="checkbox"
              checked={confirmDuplicate}
              onChange={(e) => setConfirmDuplicate(e.target.checked)}
            />
            Confirmo que é um cadastro novo, diferente do(s) cliente(s) acima.
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || (hasDuplicates && !confirmDuplicate)}
        className="w-fit rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
      >
        {hasDuplicates ? "Salvar mesmo assim" : isPending ? "Salvando…" : "Cadastrar cliente"}
      </button>
    </form>
  );
}
