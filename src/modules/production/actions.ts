"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  completeProduction,
  createManualProductionOrder,
  updateProductionOrderDetails,
  type CompleteProductionInput,
  type CreateManualProductionOrderInput,
  type UpdateProductionOrderInput,
} from "@/modules/production/services/production";
import type { ProductionPrintStatus } from "@prisma/client";

export type ProductionFormState = { error?: string } | undefined;

const MANUAL_STATUS_VALUES: ProductionPrintStatus[] = ["AGUARDANDO", "IMPRIMINDO", "FALHOU"];

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  return value ? new Date(value) : null;
}

/**
 * Cria uma ordem de produção manualmente — caminho da UI para quando a
 * versão de orçamento aprovada da oportunidade não veio de um Job (a
 * criação automática acontece dentro de `approveVersion`, sem passar por
 * uma Server Action).
 */
export async function createManualProductionOrderAction(
  _prevState: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const { userId } = await requirePermission(PERMISSIONS.PRODUCTION_MANAGE);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!opportunityId) return { error: "Oportunidade não informada." };

  const input: CreateManualProductionOrderInput = {
    opportunityId,
    printerId: String(formData.get("printerId") ?? "") || null,
    responsibleId: String(formData.get("responsibleId") ?? "") || null,
    plannedStartAt: parseDate(formData.get("plannedStartAt")),
    plannedEndAt: parseDate(formData.get("plannedEndAt")),
    technicalNotes: String(formData.get("technicalNotes") ?? "").trim() || null,
  };

  try {
    await createManualProductionOrder(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

/**
 * Atualiza os dados técnicos de uma ordem já existente (impressora,
 * responsável, datas previstas, observações, status de impressão manual —
 * nunca CONCLUIDA, isso só acontece via `completeProductionAction`).
 */
export async function updateProductionOrderAction(
  _prevState: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const { userId } = await requirePermission(PERMISSIONS.PRODUCTION_MANAGE);

  const orderId = String(formData.get("orderId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!orderId) return { error: "Ordem de produção não informada." };

  const printStatusRaw = String(formData.get("printStatus") ?? "");
  const printStatus = MANUAL_STATUS_VALUES.includes(printStatusRaw as ProductionPrintStatus)
    ? (printStatusRaw as ProductionPrintStatus)
    : undefined;

  const input: UpdateProductionOrderInput = {
    printerId: String(formData.get("printerId") ?? "") || null,
    responsibleId: String(formData.get("responsibleId") ?? "") || null,
    plannedStartAt: parseDate(formData.get("plannedStartAt")),
    plannedEndAt: parseDate(formData.get("plannedEndAt")),
    technicalNotes: String(formData.get("technicalNotes") ?? "").trim() || null,
    printStatus,
  };

  try {
    await updateProductionOrderDetails(orderId, input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

/**
 * Conclui a produção (PROD-3): horas reais + gramas reais por filamento
 * (campos dinâmicos `actualGrams_<filamentId>` no formulário, um por
 * `JobFilament` da ordem) — convertendo a reserva em consumo real.
 */
export async function completeProductionAction(
  _prevState: ProductionFormState,
  formData: FormData,
): Promise<ProductionFormState> {
  const { userId } = await requirePermission(PERMISSIONS.PRODUCTION_MANAGE);

  const orderId = String(formData.get("orderId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!orderId) return { error: "Ordem de produção não informada." };

  const actualHours = String(formData.get("actualHours") ?? "").trim();
  if (!actualHours) return { error: "Informe as horas reais de impressão." };

  const filamentActuals: CompleteProductionInput["filamentActuals"] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("actualGrams_")) continue;
    const filamentId = key.slice("actualGrams_".length);
    const raw = String(value).trim();
    if (!filamentId || !raw) continue;
    filamentActuals.push({ filamentId, actualGrams: raw });
  }

  const input: CompleteProductionInput = {
    actualHours,
    filamentActuals,
    technicalNotes: String(formData.get("technicalNotes") ?? "").trim() || null,
  };

  try {
    await completeProduction(orderId, input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/crm");
  return undefined;
}
