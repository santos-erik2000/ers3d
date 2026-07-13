import Link from "next/link";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { listCustomers } from "@/modules/customers/services/customers";
import { listUsersWithRoles } from "@/modules/auth/services/users";
import { formatDocument, formatPhone } from "@/modules/customers/format";
import { NewCustomerForm } from "./new-customer-form";

export default async function CustomersPage() {
  await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);

  const [customers, users] = await Promise.all([listCustomers(), listUsersWithRoles()]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Clientes</h1>
      <p className="mt-1 text-sm text-text-muted">
        Cadastro de clientes PF/PJ com detecção de duplicidade (<code>customers.manage</code>).
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Nome</th>
              <th className="px-4 py-3 text-left font-semibold">Tipo</th>
              <th className="px-4 py-3 text-left font-semibold">Documento</th>
              <th className="px-4 py-3 text-left font-semibold">Telefone</th>
              <th className="px-4 py-3 text-left font-semibold">E-mail</th>
              <th className="px-4 py-3 text-left font-semibold">Empresa</th>
              <th className="px-4 py-3 text-left font-semibold">Responsável</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-text-muted">
                  Nenhum cliente cadastrado ainda. Use o formulário abaixo para criar o primeiro.
                </td>
              </tr>
            )}
            {customers.map((customer) => (
              <tr key={customer.id} className="border-t border-border bg-surface">
                <td className="px-4 py-3 text-text">
                  <Link
                    href={`/clientes/${customer.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {customer.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {customer.type === "PF" ? "Pessoa física" : "Pessoa jurídica"}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {formatDocument(customer.type, customer.document)}
                </td>
                <td className="px-4 py-3 text-text-muted">{formatPhone(customer.phone)}</td>
                <td className="px-4 py-3 text-text-muted">{customer.email ?? "—"}</td>
                <td className="px-4 py-3 text-text-muted">{customer.company?.name ?? "—"}</td>
                <td className="px-4 py-3 text-text-muted">{customer.owner?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      customer.status === "ACTIVE"
                        ? "bg-success-soft text-success"
                        : "bg-neutral-soft text-neutral"
                    }`}
                  >
                    {customer.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 max-w-2xl">
        <h2 className="text-sm font-semibold text-text">Novo cliente</h2>
        <p className="mt-1 text-xs text-text-muted">
          Antes de salvar, checamos e-mail, telefone e CPF/CNPJ contra a base — se houver coincidência,
          você decide se é o mesmo cliente ou um cadastro novo.
        </p>
        <NewCustomerForm owners={users.map((u) => ({ id: u.id, name: u.name }))} />
      </div>
    </div>
  );
}
