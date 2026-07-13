"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  createOpportunity,
  moveStage,
  type OpportunityInput,
} from "@/modules/crm/services/opportunities";
import type { OpportunityPriority, OpportunityStage } from "@prisma/client";

export type OpportunityFormState = { error?: string } | undefined;

function parseInput(formData: FormData): OpportunityInput {
  const deadlineRaw = String(formData.get("deadlineAt") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "");
  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority: OpportunityPriority = ["LOW", "MEDIUM", "HIGH"].includes(priorityRaw)
    ? (priorityRaw as OpportunityPriority)
    : "MEDIUM";

  return {
    title: String(formData.get("title") ?? "").trim(),
    customerId: String(formData.get("customerId") ?? ""),
    value: String(formData.get("value") ?? "0") || "0",
    ownerId: String(formData.get("ownerId") ?? "") || null,
    deadlineAt: deadlineRaw ? new Date(deadlineRaw) : null,
    priority,
    tags: tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

export async function createOpportunityAction(
  _prevState: OpportunityFormState,
  formData: FormData,
): Promise<OpportunityFormState> {
  const { userId } = await requirePermission(PERMISSIONS.CRM_MANAGE);

  const input = parseInput(formData);
  if (!input.title) return { error: "Informe o nome do projeto/oportunidade." };
  if (!input.customerId) return { error: "Selecione um cliente." };

  try {
    await createOpportunity(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/crm");
  return undefined;
}

/**
 * Move um card de etapa — chamada tanto pelo drop do drag-and-drop quanto
 * pelo botão de fallback "mover para [próxima etapa]" no card. Sempre passa
 * pela mesma checagem de permissão e pela mesma validação de transição do
 * service (nunca confia na etapa de destino que a UI mandou sem revalidar).
 */
export async function moveOpportunityStageAction(
  opportunityId: string,
  toStage: OpportunityStage,
  note?: string | null,
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.CRM_MANAGE);

  try {
    await moveStage(opportunityId, toStage, userId, note ?? null);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/crm");
  return {};
}
