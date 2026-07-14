"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  createDelivery,
  markDeliveryAsDelivered,
  markDeliveryAsShipped,
  updateDelivery,
  type CreateDeliveryInput,
  type UpdateDeliveryChecklistInput,
  type UpdateDeliveryInput,
} from "@/modules/deliveries/services/deliveries";
import type { DeliveryMethod } from "@prisma/client";

export type DeliveryFormState = { error?: string } | undefined;

const VALID_METHODS: DeliveryMethod[] = ["RETIRADA", "ENTREGA_PROPRIA", "CORREIOS", "TRANSPORTADORA", "MOTOBOY"];

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "").trim();
  return value ? new Date(value) : null;
}

/** Registra a entrega (DEL-1) — exige `deliveries.manage` e a oportunidade já na etapa Entrega (checado no serviço). */
export async function createDeliveryAction(
  _prevState: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const { userId } = await requirePermission(PERMISSIONS.DELIVERIES_MANAGE);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!opportunityId) return { error: "Oportunidade não informada." };

  const methodRaw = String(formData.get("method") ?? "");
  if (!VALID_METHODS.includes(methodRaw as DeliveryMethod)) {
    return { error: "Selecione um método de entrega válido." };
  }

  const input: CreateDeliveryInput = {
    opportunityId,
    method: methodRaw as DeliveryMethod,
    address: String(formData.get("address") ?? "").trim() || null,
    recipientName: String(formData.get("recipientName") ?? "").trim() || null,
    trackingCode: String(formData.get("trackingCode") ?? "").trim() || null,
    expectedAt: parseDate(formData.get("expectedAt")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };

  try {
    await createDelivery(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

/**
 * Atualiza os dados da entrega + o estado do checklist de embalagem — os
 * itens chegam como `checklistIds` (lista de ids separados por vírgula,
 * gerada pelo formulário em src/app/(app)/crm/[id]/delivery-panel.tsx) mais
 * um par `checklist_<id>_checked`/`checklist_<id>_notes` por item.
 */
export async function updateDeliveryAction(
  _prevState: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const { userId } = await requirePermission(PERMISSIONS.DELIVERIES_MANAGE);

  const deliveryId = String(formData.get("deliveryId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!deliveryId) return { error: "Entrega não informada." };

  const methodRaw = String(formData.get("method") ?? "");
  const method = VALID_METHODS.includes(methodRaw as DeliveryMethod) ? (methodRaw as DeliveryMethod) : undefined;

  const checklistIds = String(formData.get("checklistIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const checklist: UpdateDeliveryChecklistInput[] = checklistIds.map((id) => ({
    id,
    checked: formData.get(`checklist_${id}_checked`) === "on",
    notes: String(formData.get(`checklist_${id}_notes`) ?? "").trim() || null,
  }));

  const input: UpdateDeliveryInput = {
    method,
    address: String(formData.get("address") ?? "").trim() || null,
    recipientName: String(formData.get("recipientName") ?? "").trim() || null,
    trackingCode: String(formData.get("trackingCode") ?? "").trim() || null,
    expectedAt: parseDate(formData.get("expectedAt")),
    notes: String(formData.get("notes") ?? "").trim() || null,
    proofUrl: String(formData.get("proofUrl") ?? "").trim() || null,
    checklist,
  };

  try {
    await updateDelivery(deliveryId, input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

export async function markDeliveryAsShippedAction(
  _prevState: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const { userId } = await requirePermission(PERMISSIONS.DELIVERIES_MANAGE);

  const deliveryId = String(formData.get("deliveryId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!deliveryId) return { error: "Entrega não informada." };

  try {
    await markDeliveryAsShipped(deliveryId, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  return undefined;
}

/**
 * Marca a entrega como concluída (DEL-2) — a partir daqui,
 * `hasDeliveredDelivery` passa a enxergar a entrega registrada, uma das três
 * pré-condições reais de Entrega → Concluído
 * (src/modules/crm/services/opportunities.ts, `validateTransition`).
 */
export async function markDeliveryAsDeliveredAction(
  _prevState: DeliveryFormState,
  formData: FormData,
): Promise<DeliveryFormState> {
  const { userId } = await requirePermission(PERMISSIONS.DELIVERIES_MANAGE);

  const deliveryId = String(formData.get("deliveryId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!deliveryId) return { error: "Entrega não informada." };

  const proofUrl = String(formData.get("proofUrl") ?? "").trim() || null;

  try {
    await markDeliveryAsDelivered(deliveryId, userId, proofUrl);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/crm");
  return undefined;
}
