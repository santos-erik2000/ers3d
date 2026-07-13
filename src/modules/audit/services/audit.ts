import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  userId?: string | null;
};

/**
 * Ponto único de escrita da trilha de auditoria (Etapa 1 / Etapa 3, seção 04).
 * Toda operação sensível deve chamar isto — nunca gravar audit_logs manualmente
 * fora deste helper, para manter o formato consistente entre módulos.
 *
 * Aceita um `tx` opcional para ser chamado dentro da mesma transação da operação
 * de negócio (ex.: aprovar orçamento + gerar conta a receber + registrar auditoria
 * tudo atômico) — ver regra de transação em Etapa 1, seção 11.
 */
export async function recordAudit(
  entry: AuditEntry,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason,
      userId: entry.userId ?? null,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
