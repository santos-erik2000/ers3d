import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { getCustomerById } from "@/modules/customers/services/customers";
import { formatDocument, formatPhone } from "@/modules/customers/format";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);
  const { id } = await params;

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  return (
    <div className="max-w-4xl">
      <Link href="/clientes" className="text-sm text-accent hover:underline">
        ← Clientes
      </Link>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-faint">Cliente</p>
      <h1 className="mt-1 text-2xl font-semibold text-text">{customer.name}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {customer.type === "PF" ? "Pessoa física" : "Pessoa jurídica"} ·{" "}
        {formatDocument(customer.type, customer.document)}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Dados de contato</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <Row label="E-mail" value={customer.email} />
            <Row label="Telefone" value={formatPhone(customer.phone)} />
            <Row label="WhatsApp" value={formatPhone(customer.whatsapp)} />
            <Row label="Endereço" value={customer.address} />
            <Row
              label="Cidade/UF"
              value={[customer.city, customer.state].filter(Boolean).join("/") || null}
            />
            <Row label="CEP" value={customer.zipCode} />
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Dados comerciais</h2>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <Row label="Empresa" value={customer.company?.name} />
            <Row label="Responsável" value={customer.owner?.name} />
            <Row label="Origem" value={customer.origin} />
            <Row label="Segmento" value={customer.segment} />
            <Row label="Status" value={customer.status === "ACTIVE" ? "Ativo" : "Inativo"} />
            <Row label="Tags" value={customer.tags.length ? customer.tags.join(", ") : null} />
            <Row
              label="Último contato"
              value={customer.lastContactAt ? customer.lastContactAt.toLocaleDateString("pt-BR") : null}
            />
            <Row
              label="Próximo contato"
              value={customer.nextContactAt ? customer.nextContactAt.toLocaleDateString("pt-BR") : null}
            />
            <Row label="Cadastrado em" value={customer.createdAt.toLocaleDateString("pt-BR")} />
          </dl>
        </section>
      </div>

      {customer.notes && (
        <section className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text">Observações</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">{customer.notes}</p>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-dashed border-border-strong bg-surface-alt p-5">
        <h2 className="text-sm font-semibold text-text">Linha do tempo</h2>
        <p className="mt-2 text-sm text-text-muted">
          Esqueleto da página 360° (Etapa 2, épico E2 — CUST-3). A linha do tempo consolidada
          (interações, orçamentos, pedidos, produção, entregas, financeiro) é populada conforme os
          módulos CRM, Calculadora, Produção e Financeiro entrarem em produção nos próximos sprints —
          por enquanto este espaço só reserva o layout.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text">{value || "—"}</dd>
    </div>
  );
}
