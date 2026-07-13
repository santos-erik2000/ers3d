"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  approveVersion,
  createManualVersion,
  createVersionFromJob,
  rejectVersion,
  sendVersion,
  type JobQuoteVersionInput,
  type ManualQuoteVersionInput,
} from "@/modules/quotes/services/quotes";

export type QuoteFormState = { error?: string } | undefined;

function parseCommonFields(formData: FormData, opportunityId: string) {
  const discountRaw = String(formData.get("discount") ?? "0").trim();
  const paymentTerms = String(formData.get("paymentTerms") ?? "").trim() || null;
  const deliveryDeadlineRaw = String(formData.get("deliveryDeadline") ?? "").trim();
  const quantityRaw = String(formData.get("quantity") ?? "1").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  return {
    opportunityId,
    discount: discountRaw || "0",
    paymentTerms,
    deliveryDeadline: deliveryDeadlineRaw ? new Date(deliveryDeadlineRaw) : null,
    quantity: Number.parseInt(quantityRaw, 10) || undefined,
    notes,
  };
}

/**
 * Gera uma nova versão de orçamento a partir de um Job já calculado na
 * calculadora (CALC-4). Reaproveita `job.finalPrice` — o único valor
 * informado aqui é o desconto opcional.
 */
export async function createVersionFromJobAction(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const { userId } = await requirePermission(PERMISSIONS.QUOTES_MANAGE);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  if (!opportunityId) return { error: "Oportunidade não informada." };
  if (!jobId) return { error: "Selecione um job calculado na calculadora." };

  const input: JobQuoteVersionInput = { ...parseCommonFields(formData, opportunityId), jobId };

  try {
    await createVersionFromJob(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

/**
 * Gera uma nova versão de orçamento manual — sem Job de origem. Justificativa
 * obrigatória (regra do briefing original).
 */
export async function createManualVersionAction(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const { userId } = await requirePermission(PERMISSIONS.QUOTES_MANAGE);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!opportunityId) return { error: "Oportunidade não informada." };

  const originalValue = String(formData.get("originalValue") ?? "").trim();
  const manualJustification = String(formData.get("manualJustification") ?? "").trim();
  if (!originalValue) return { error: "Informe o valor original do orçamento manual." };
  if (!manualJustification) {
    return { error: "Informe a justificativa do orçamento manual (obrigatória)." };
  }

  const input: ManualQuoteVersionInput = {
    ...parseCommonFields(formData, opportunityId),
    originalValue,
    manualJustification,
  };

  try {
    await createManualVersion(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

export async function sendQuoteVersionAction(
  quoteVersionId: string,
  opportunityId: string,
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.QUOTES_MANAGE);

  try {
    await sendVersion(quoteVersionId, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return {};
}

export async function approveQuoteVersionAction(
  quoteVersionId: string,
  opportunityId: string,
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.QUOTES_MANAGE);

  try {
    await approveVersion(quoteVersionId, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/crm");
  return {};
}

export async function rejectQuoteVersionAction(
  quoteVersionId: string,
  opportunityId: string,
  reason: string,
): Promise<{ error?: string }> {
  const { userId } = await requirePermission(PERMISSIONS.QUOTES_MANAGE);

  try {
    await rejectVersion(quoteVersionId, reason, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return {};
}
