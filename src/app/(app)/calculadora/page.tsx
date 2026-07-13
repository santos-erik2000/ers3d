import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { listCustomers } from "@/modules/customers/services/customers";
import { listUsersWithRoles } from "@/modules/auth/services/users";
import { listFilaments } from "@/modules/filaments/services/filaments";
import { listJobs, listProjects } from "@/modules/jobs/services/jobs";
import { PROJECT_STATUS_LABEL, formatCurrency, formatPercent } from "@/modules/jobs/format";
import { NewProjectForm } from "./new-project-form";
import { NewJobForm } from "./new-job-form";

export default async function CalculadoraPage() {
  // Sprint 4: página inteira exige `jobs.manage`, mesmo para visualizar —
  // mesmo padrão do Kanban CRM (ver nota em src/app/(app)/crm/page.tsx).
  await requirePermission(PERMISSIONS.JOBS_MANAGE);

  const [projects, filaments, customers, users, jobs] = await Promise.all([
    listProjects(),
    listFilaments(),
    listCustomers(),
    listUsersWithRoles(),
    listJobs(),
  ]);

  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const filamentOptions = filaments
    .filter((f) => f.status === "ACTIVE")
    .map((f) => ({
      id: f.id,
      name: `${f.name} (${f.material}${f.color ? ` · ${f.color}` : ""}) — ${formatCurrency(f.pricePerKg)}/kg`,
    }));
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));
  const userOptions = users.map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Calculadora 3D</h1>
      <p className="mt-1 text-sm text-text-muted">
        Precificação de jobs de impressão a partir do custo de filamento, energia e percentuais de
        manutenção/segurança/lucro (<code>jobs.manage</code>). O job é uma simulação — não debita estoque
        ainda (isso entra no Sprint 6, quando a produção real existir).
      </p>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-text">Novo projeto</h2>
          <p className="mt-1 text-xs text-text-muted">Um job de cálculo sempre pertence a um projeto.</p>
          <NewProjectForm customers={customerOptions} users={userOptions} />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-text">Novo job de cálculo</h2>
          <p className="mt-1 text-xs text-text-muted">
            Percentuais são digitados como número inteiro (ex.: 20 para 20%) — a conversão para fração é
            automática. Se manutenção + segurança + lucro somarem 100% ou mais, o cálculo é rejeitado.
          </p>
          <NewJobForm projects={projectOptions} filaments={filamentOptions} />
        </div>
      </div>

      <div className="mt-10 max-w-6xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-text">Jobs calculados</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Projeto</th>
                <th className="px-4 py-3 text-left font-semibold">Custo filamentos</th>
                <th className="px-4 py-3 text-left font-semibold">Custo energia</th>
                <th className="px-4 py-3 text-left font-semibold">Custo direto</th>
                <th className="px-4 py-3 text-left font-semibold">Manutenção/Segurança/Lucro</th>
                <th className="px-4 py-3 text-left font-semibold">Preço final</th>
                <th className="px-4 py-3 text-left font-semibold">Regra</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                    Nenhum job calculado ainda.
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-border bg-surface">
                  <td className="px-4 py-3 text-text">{job.project.name}</td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(job.filamentsCost)}</td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(job.energyCost)}</td>
                  <td className="px-4 py-3 text-text-muted">{formatCurrency(job.directCost)}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {formatPercent(job.maintenancePct)} / {formatPercent(job.safetyPct)} /{" "}
                    {formatPercent(job.profitPct)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-text">{formatCurrency(job.finalPrice)}</td>
                  <td className="px-4 py-3 text-text-muted">{job.ruleVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-10 max-w-6xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-text">Projetos</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Nome</th>
                <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                <th className="px-4 py-3 text-left font-semibold">Categoria</th>
                <th className="px-4 py-3 text-left font-semibold">Responsável</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                    Nenhum projeto cadastrado ainda.
                  </td>
                </tr>
              )}
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border bg-surface">
                  <td className="px-4 py-3 font-medium text-text">{p.name}</td>
                  <td className="px-4 py-3 text-text-muted">{p.customer?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{p.category ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{p.responsible?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{PROJECT_STATUS_LABEL[p.status]}</td>
                  <td className="px-4 py-3 text-text-muted">{p.jobs.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
