"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  closeCycle,
  type CycleClosureDecision,
} from "@/modules/crm/services/cycles";

/**
 * Fecha um ciclo mensal — chamada com a lista de decisões já coletada pela
 * tela (uma por card em aberto do ciclo). Nunca fecha "no escuro": se a lista
 * de decisões não cobrir exatamente os cards em aberto, o service rejeita e
 * nada é aplicado (CRM-5, caso crítico da Etapa 2 seção 05).
 */
export async function closeCycleAction(
  cycleId: string,
  decisions: CycleClosureDecision[],
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.CRM_MANAGE);

  try {
    await closeCycle(cycleId, decisions, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/crm");
  return {};
}
