import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { isLowStock, listFilaments, listMovements } from "@/modules/filaments/services/filaments";
import { FILAMENT_STATUS_LABEL, MOVEMENT_TYPE_LABEL, formatCurrency, formatGrams } from "@/modules/filaments/format";
import { NewFilamentForm } from "./new-filament-form";
import { NewMovementForm } from "./new-movement-form";

export default async function EstoquePage() {
  // Sprint 4: página inteira exige `filaments.manage`, mesmo para
  // visualizar — mesmo padrão do Kanban CRM (ainda não existe uma
  // permissão de leitura separada, ver nota em src/app/(app)/crm/page.tsx).
  await requirePermission(PERMISSIONS.FILAMENTS_MANAGE);

  const [filaments, movements] = await Promise.all([listFilaments(), listMovements(undefined, 30)]);

  const filamentOptions = filaments.map((f) => ({ id: f.id, name: `${f.name} (${f.material}${f.color ? ` · ${f.color}` : ""})` }));

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Estoque de filamentos</h1>
      <p className="mt-1 text-sm text-text-muted">
        Cadastro de filamentos, saldo corrente e movimentações de estoque (<code>filaments.manage</code>).
      </p>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Nome</th>
              <th className="px-4 py-3 text-left font-semibold">Material</th>
              <th className="px-4 py-3 text-left font-semibold">Cor</th>
              <th className="px-4 py-3 text-left font-semibold">Preço/kg</th>
              <th className="px-4 py-3 text-left font-semibold">Disponível</th>
              <th className="px-4 py-3 text-left font-semibold">Mínimo</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filaments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                  Nenhum filamento cadastrado ainda. Use o formulário abaixo para criar o primeiro.
                </td>
              </tr>
            )}
            {filaments.map((filament) => {
              const low = isLowStock(filament);
              return (
                <tr key={filament.id} className="border-t border-border bg-surface">
                  <td className="px-4 py-3 font-medium text-text">{filament.name}</td>
                  <td className="px-4 py-3 text-text-muted">{filament.material}</td>
                  <td className="px-4 py-3 text-text-muted">{filament.color ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(filament.pricePerKg)}</td>
                  <td className="px-4 py-3">
                    <span className={low ? "font-semibold text-danger" : "text-text"}>
                      {formatGrams(filament.availableGrams)}
                    </span>
                    {low && (
                      <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                        Abaixo do mínimo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{formatGrams(filament.minStockGrams)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        filament.status === "ACTIVE"
                          ? "bg-success-soft text-success"
                          : "bg-neutral-soft text-neutral"
                      }`}
                    >
                      {FILAMENT_STATUS_LABEL[filament.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-text">Novo filamento</h2>
          <p className="mt-1 text-xs text-text-muted">
            &quot;Peso inicial&quot; e &quot;gramas disponíveis&quot; podem divergir se o cadastro representa
            um estoque já parcialmente usado.
          </p>
          <NewFilamentForm />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-text">Nova movimentação</h2>
          <p className="mt-1 text-xs text-text-muted">
            Entrada/Devolução somam ao saldo; Perda subtrai; Ajuste/Correção aceitam um valor negativo para
            reduzir o saldo. Nunca é permitido deixar o saldo negativo.
          </p>
          <NewMovementForm filaments={filamentOptions} />
        </div>
      </div>

      <div className="mt-10 max-w-6xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-text">Últimas movimentações</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Filamento</th>
                <th className="px-4 py-3 text-left font-semibold">Tipo</th>
                <th className="px-4 py-3 text-left font-semibold">Quantidade</th>
                <th className="px-4 py-3 text-left font-semibold">Saldo anterior</th>
                <th className="px-4 py-3 text-left font-semibold">Saldo posterior</th>
                <th className="px-4 py-3 text-left font-semibold">Motivo</th>
                <th className="px-4 py-3 text-left font-semibold">Quem</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                    Nenhuma movimentação registrada ainda.
                  </td>
                </tr>
              )}
              {movements.map((m) => (
                <tr key={m.id} className="border-t border-border bg-surface">
                  <td className="px-4 py-3 text-text">{m.filament.name}</td>
                  <td className="px-4 py-3 text-text-muted">{MOVEMENT_TYPE_LABEL[m.type]}</td>
                  <td className="px-4 py-3 text-text-muted">{formatGrams(m.quantityGrams)}</td>
                  <td className="px-4 py-3 text-text-muted">{formatGrams(m.balanceBefore)}</td>
                  <td className="px-4 py-3 text-text-muted">{formatGrams(m.balanceAfter)}</td>
                  <td className="px-4 py-3 text-text-muted">{m.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{m.user?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
