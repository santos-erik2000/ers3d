import { auth } from "@/auth";
import { userHasPermission, type PermissionSlug } from "@/modules/auth/services/permissions";

export class ForbiddenError extends Error {
  constructor(message = "Acesso negado.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Não autenticado.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Guarda de permissão para Server Actions e Route Handlers.
 *
 * Regra de ouro (Etapa 1 / Etapa 3): o front-end pode esconder um botão, mas
 * a decisão de acesso é sempre tomada aqui, de novo, no backend. Nenhuma
 * Server Action que altera estado deve pular esta chamada.
 */
export async function requirePermission(slug: PermissionSlug): Promise<{ userId: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new UnauthorizedError();

  const allowed = await userHasPermission(userId, slug);
  if (!allowed) throw new ForbiddenError();

  return { userId };
}

export async function requireSession(): Promise<{ userId: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new UnauthorizedError();
  return { userId };
}
