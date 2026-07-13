import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { listRoles, listUsersWithRoles } from "@/modules/auth/services/users";
import { blockUserAction, unblockUserAction } from "@/modules/auth/actions";
import { NewUserForm } from "./new-user-form";

export default async function UsersPage() {
  await requirePermission(PERMISSIONS.USERS_MANAGE);

  const [users, roles] = await Promise.all([listUsersWithRoles(), listRoles()]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-text">Usuários &amp; Permissões</h1>
      <p className="mt-1 text-sm text-text-muted">
        Permissão verificada por ação (<code>users.manage</code>), não pelo nome do perfil.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Nome</th>
              <th className="px-4 py-3 text-left font-semibold">E-mail</th>
              <th className="px-4 py-3 text-left font-semibold">Perfil</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-border bg-surface">
                <td className="px-4 py-3 text-text">{user.name}</td>
                <td className="px-4 py-3 text-text-muted">{user.email}</td>
                <td className="px-4 py-3 text-text-muted">
                  {user.userRoles.map((ur) => ur.role.name).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      user.status === "ACTIVE"
                        ? "bg-success-soft text-success"
                        : "bg-danger-soft text-danger"
                    }`}
                  >
                    {user.status === "ACTIVE" ? "Ativo" : "Bloqueado"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.status === "ACTIVE" ? (
                    <form action={blockUserAction.bind(null, user.id)}>
                      <button
                        type="submit"
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Bloquear
                      </button>
                    </form>
                  ) : (
                    <form action={unblockUserAction.bind(null, user.id)}>
                      <button
                        type="submit"
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Desbloquear
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 max-w-sm">
        <h2 className="text-sm font-semibold text-text">Novo usuário</h2>
        <NewUserForm roles={roles.map((r) => ({ slug: r.slug, name: r.name }))} />
      </div>
    </div>
  );
}
