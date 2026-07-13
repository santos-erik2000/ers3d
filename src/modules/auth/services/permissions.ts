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
  // Criar oportunidades e mover cards do Kanban (Sprint 3 — épico E3).
  // TODO (planejamento/02-personas-jornadas-historias.html §06): a granularidade
  // por transição/perfil (Comercial só move Proposta↔Negociação, Técnico só move
  // Desenvolvimento↔Qualidade↔Entrega, retrocesso manual fora do fluxo só Admin)
  // depende dos perfis "Comercial" e "Técnico", que ainda não existem no seed
  // (hoje só ROOT/Administrador/Contador) — quando existirem, dividir esta
  // permissão única em ações mais finas (ex.: "crm.stage.move.comercial",
  // "crm.stage.move.tecnico", "crm.stage.revert") em vez de checar por nome de
  // perfil. Por enquanto, uma permissão nomeada só cobre "pode mexer no Kanban".
  CRM_MANAGE: "crm.manage",
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
