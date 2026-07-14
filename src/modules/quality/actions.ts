"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { QUALITY_CHECKLIST_ITEMS } from "@/modules/quality/format";
import {
  BusinessRuleError,
  submitQualityCheck,
  type QualityCheckItemInput,
  type SubmitQualityCheckInput,
} from "@/modules/quality/services/quality";
import type { QualityCheckResult } from "@prisma/client";

export type QualityFormState = { error?: string } | undefined;

const VALID_RESULTS: QualityCheckResult[] = ["APROVADO", "REPROVADO", "APROVADO_COM_RESSALVA"];

/**
 * Registra o checklist de qualidade (QUAL-1/QUAL-2) — os campos dos itens
 * chegam indexados (`item_<i>_label`/`item_<i>_passed`/`item_<i>_notes`/
 * `item_<i>_evidence`), um por posição de QUALITY_CHECKLIST_ITEMS, gerados
 * pelo formulário em src/app/(app)/crm/[id]/quality-panel.tsx.
 */
export async function submitQualityCheckAction(
  _prevState: QualityFormState,
  formData: FormData,
): Promise<QualityFormState> {
  const { userId } = await requirePermission(PERMISSIONS.QUALITY_MANAGE);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  const productionOrderId = String(formData.get("productionOrderId") ?? "");
  if (!opportunityId || !productionOrderId) {
    return { error: "Oportunidade ou ordem de produção não informada." };
  }

  const resultRaw = String(formData.get("result") ?? "");
  if (!VALID_RESULTS.includes(resultRaw as QualityCheckResult)) {
    return { error: "Selecione um resultado válido para o checklist." };
  }
  const result = resultRaw as QualityCheckResult;

  const items: QualityCheckItemInput[] = QUALITY_CHECKLIST_ITEMS.map((_, index) => ({
    label: String(formData.get(`item_${index}_label`) ?? "").trim(),
    passed: formData.get(`item_${index}_passed`) === "on",
    notes: String(formData.get(`item_${index}_notes`) ?? "").trim() || null,
    evidencePhotoUrl: String(formData.get(`item_${index}_evidence`) ?? "").trim() || null,
  })).filter((item) => item.label);

  const rejectionReason = String(formData.get("rejectionReason") ?? "").trim() || null;

  const input: SubmitQualityCheckInput = {
    opportunityId,
    productionOrderId,
    items,
    result,
    rejectionReason,
  };

  try {
    await submitQualityCheck(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/crm");
  return undefined;
}
