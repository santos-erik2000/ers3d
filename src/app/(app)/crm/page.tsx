import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { listCustomers } from "@/modules/customers/services/customers";
import { listUsersWithRoles } from "@/modules/auth/services/users";
import { listOpportunities } from "@/modules/crm/services/opportunities";
import { CrmBoard, type BoardOpportunity } from "./crm-board";
import { NewOpportunityForm } from "./new-opportunity-form";

export default async function CrmPage() {
  // Sprint 3: página inteira exige `crm.manage`, mesmo para visualizar —
  // ainda não existe uma permissão de leitura separada (ex.: "crm.read")
  // porque só ROOT/Administrador operam o Kanban por enquanto (não há perfis
  // Comercial/Técnico no seed ainda). Revisar quando esses perfis existirem.
  await requirePermission(PERMISSIONS.CRM_MANAGE);

  const [opportunities, users, customers] = await Promise.all([
    listOpportunities(),
    listUsersWithRoles(),
    listCustomers(),
  ]);

  const boardOpportunities: BoardOpportunity[] = opportunities.map((o) => {
    const lastMove = o.stageHistory[0]?.movedAt ?? o.createdAt;
    return {
      id: o.id,
      title: o.title,
      value: o.value.toString(),
      stage: o.stage,
      priority: o.priority,
      tags: o.tags,
      deadlineAt: o.deadlineAt ? o.deadlineAt.toISOString() : null,
      customer: { id: o.customer.id, name: o.customer.name },
      owner: o.owner ? { id: o.owner.id, name: o.owner.name } : null,
      lastMovedAt: lastMove.toISOString(),
    };
  });

  const owners = users.map((u) => ({ id: u.id, name: u.name }));
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-text">CRM — Kanban</h1>
      <p className="mt-1 text-sm text-text-muted">
        Quadro comercial com as 6 etapas do fluxo (<code>crm.manage</code>). Arraste um card entre colunas ou
        use o botão de avanço rápido no card.
      </p>

      <div className="mt-6">
        <CrmBoard initialOpportunities={boardOpportunities} owners={owners} customers={customerOptions} />
      </div>

      <div className="mt-10 max-w-2xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-text">Nova oportunidade</h2>
        <p className="mt-1 text-xs text-text-muted">
          Toda oportunidade nova entra na coluna Proposta. Vincule a um cliente já cadastrado.
        </p>
        <NewOpportunityForm customers={customerOptions} owners={owners} />
      </div>
    </div>
  );
}
