import * as argon2 from "argon2";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";

export const ROLE_SLUGS = {
  ROOT: "root",
  ADMIN: "admin",
  CONTADOR: "contador",
} as const;

export class BusinessRuleError extends Error {}

async function assertNotLastActiveRoot(targetUserId: string, action: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!target) throw new BusinessRuleError("Usuário não encontrado.");

  const isRoot = target.userRoles.some((ur) => ur.role.slug === ROLE_SLUGS.ROOT);
  if (!isRoot) return;

  const otherActiveRoots = await prisma.user.count({
    where: {
      id: { not: targetUserId },
      status: "ACTIVE",
      userRoles: { some: { role: { slug: ROLE_SLUGS.ROOT } } },
    },
  });

  if (otherActiveRoots === 0) {
    throw new BusinessRuleError(
      `Não é possível ${action}: este é o último usuário ROOT ativo do sistema.`,
    );
  }
}

export async function createUser(
  input: { name: string; email: string; password: string; roleSlug: string },
  actorUserId: string,
) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new BusinessRuleError("Já existe um usuário com este e-mail.");

  const role = await prisma.role.findUnique({ where: { slug: input.roleSlug } });
  if (!role) throw new BusinessRuleError("Perfil inválido.");

  const passwordHash = await argon2.hash(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        userRoles: { create: { roleId: role.id } },
      },
    });
    await recordAudit(
      {
        entityType: "user",
        entityId: created.id,
        action: "user.create",
        after: { name: created.name, email: created.email, role: role.slug },
        userId: actorUserId,
      },
      tx,
    );
    return created;
  });

  return user;
}

export async function blockUser(targetUserId: string, actorUserId: string, reason?: string) {
  await assertNotLastActiveRoot(targetUserId, "bloquear este usuário");

  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
    const after = await tx.user.update({
      where: { id: targetUserId },
      data: { status: "BLOCKED" },
    });
    await recordAudit(
      {
        entityType: "user",
        entityId: targetUserId,
        action: "user.block",
        before: { status: before.status },
        after: { status: after.status },
        reason,
        userId: actorUserId,
      },
      tx,
    );
  });
}

export async function unblockUser(targetUserId: string, actorUserId: string) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
    const after = await tx.user.update({
      where: { id: targetUserId },
      data: { status: "ACTIVE" },
    });
    await recordAudit(
      {
        entityType: "user",
        entityId: targetUserId,
        action: "user.unblock",
        before: { status: before.status },
        after: { status: after.status },
        userId: actorUserId,
      },
      tx,
    );
  });
}

export async function listUsersWithRoles() {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { userRoles: { include: { role: true } } },
  });
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" } });
}
