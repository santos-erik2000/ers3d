import Link from "next/link";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { formatCurrency, INVENTORY_STATUS_LABEL } from "@/modules/inventory/format";
import { listAllInventoryItems } from "@/modules/inventory/services/inventory";

/**
 * Visão agregada do estoque de peças (Sprint 8 — INV-1/INV-2), reunindo os
 * itens de TODAS as oportunidades — o painel dentro de /crm/[id]
 * (src/app/(app)/crm/[id]/inventory-panel.tsx) mostra e opera só os itens de
 * uma oportunidade específica; esta rota é a leitura consolidada, útil para
 * decidir vender/descartar sem precisar abrir cada oportunidade uma a uma.
 * As operações em si (vender/descartar/reservar/ajustar) continuam feitas no
 * painel da oportunidade, que sabe o contexto de cada peça — aqui é só
 * leitura + atalho de navegação.
 */
export default async function EstoquePecasPage() {
  await requirePermission(PERMISSIONS.INVENTORY_MANAGE);

  const items = await listAllInventoryItems();

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Estoque de peças</h1>
      <p className="mt-1 text-sm text-text-muted">
        Visão consolidada de todas as peças geradas por aprovações de qualidade (<code>inventory.manage</code>).
        Para vender, descartar, reservar ou ajustar, abra a oportunidade correspondente.
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Oportunidade</th>
              <th className="px-4 py-3 text-left font-semibold">Produzido</th>
              <th className="px-4 py-3 text-left font-semibold">Disponível</th>
              <th className="px-4 py-3 text-left font-semibold">Reservado</th>
              <th className="px-4 py-3 text-left font-semibold">Vendido</th>
              <th className="px-4 py-3 text-left font-semibold">Descartado</th>
              <th className="px-4 py-3 text-left font-semibold">Custo unitário</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-text-muted">
                  Nenhuma peça em estoque ainda — itens são gerados automaticamente quando um checklist de
                  qualidade é aprovado (ou aprovado com ressalva).
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="border-t border-border bg-surface">
                <td className="px-4 py-3 font-medium text-text">
                  <Link href={`/crm/${item.opportunityId}`} className="text-accent hover:underline">
                    {item.opportunity.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-muted">{item.quantityProduced}</td>
                <td className="px-4 py-3">
                  <span className={item.quantityAvailable === 0 ? "font-semibold text-danger" : "text-text"}>
                    {item.quantityAvailable}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{item.quantityReserved}</td>
                <td className="px-4 py-3 text-text-muted">{item.quantitySold}</td>
                <td className="px-4 py-3 text-text-muted">{item.quantityDiscarded}</td>
                <td className="px-4 py-3 text-text-muted">{formatCurrency(item.unitCost)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-neutral-soft px-2.5 py-0.5 text-xs font-medium text-neutral">
                    {INVENTORY_STATUS_LABEL[item.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
