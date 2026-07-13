import { prisma } from "@/lib/prisma";

/**
 * Catálogo único de permissões nomeadas (RBAC por ação — Etapa 1, seção 03).
 * Toda checagem de acesso no backend usa um destes slugs, nunca o nome do perfil.
 * Novos módulos adicionam seus próprios slugs aqui conforme forem implementados
 * (ex.: "customers.manage", "crm.stage.move", "inventory.adjust").
 */
export const PERMISSIONS = {
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  AUDIT_READ: "audit.read",
  FINANCE_READ: "finance.read",
  SETTINGS_MANAGE: "settings.manage",
  CUSTOMERS_MANAGE: "customers.manage",
} as const;

export type PermissionSlug = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export async function getUserPermissionSlugs(userId: string): Promise<Set<string>> {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          rolePermissions: { select: { permission: { select: { slug: true } } } },
        },
      },
    },
  });

  const slugs = new Set<string>();
  for (const { role } of roles) {
    for (const rp of role.rolePermissions) {
      slugs.add(rp.permission.slug);
    }
  }
  return slugs;
}

export async function userHasPermission(
  userId: string,
  slug: PermissionSlug,
): Promise<boolean> {
  const count = await prisma.userRole.count({
    where: {
      userId,
      role: { rolePermissions: { some: { permission: { slug } } } },
    },
  });
  return count > 0;
}
