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
  // Cadastro de filamentos e movimentações de estoque (Sprint 4 — épico E4/E5).
  FILAMENTS_MANAGE: "filaments.manage",
  // Projetos e jobs de cálculo da calculadora de precificação (Sprint 4 — épico E4).
  JOBS_MANAGE: "jobs.manage",
  // Criar/versionar orçamento (a partir de job ou manual justificado) e
  // aprovar/rejeitar versão, e fechar ciclo mensal do Kanban (Sprint 5 —
  // épico E4 CALC-4/CALC-5, épico E3 CRM-5).
  QUOTES_MANAGE: "quotes.manage",
  // Ordens de produção: criação manual (versão de orçamento sem job),
  // atualização de dados técnicos (impressora, responsável, datas
  // previstas, status de impressão) e conclusão da produção (apontamento de
  // horas/gramas reais, convertendo reserva em consumo) — Sprint 6, épico E5.
  PRODUCTION_MANAGE: "production.manage",
  // Registrar o checklist de qualidade (resultado aprovado/reprovado/
  // aprovado com ressalva) de uma ordem de produção concluída — Sprint 7,
  // épico E6. A reprovação (via este mesmo checklist) é o que move a
  // oportunidade de volta para Desenvolvimento e abre o retrabalho.
  QUALITY_MANAGE: "quality.manage",
  // Operações manuais de estoque de peças (reservar, liberar reserva,
  // vender, descartar, ajustar) — Sprint 8, épico E7. A geração automática do
  // InventoryItem na aprovação de qualidade não passa por esta permissão (é
  // feita dentro da transação de `quality.manage`, ver
  // src/modules/quality/services/quality.ts).
  INVENTORY_MANAGE: "inventory.manage",
  // Registrar/editar entrega (método, rastreio, checklist de embalagem) e
  // marcar como enviada/entregue — Sprint 8, épico E7.
  DELIVERIES_MANAGE: "deliveries.manage",
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
