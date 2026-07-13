"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  createFilament,
  recordMovement,
  updateFilament,
  type CreateFilamentInput,
  type FilamentInput,
  type RecordMovementInput,
} from "@/modules/filaments/services/filaments";
import type { FilamentMovementType, FilamentStatus } from "@prisma/client";

export type FilamentFormState = { error?: string } | undefined;

const FILAMENT_STATUSES: FilamentStatus[] = ["ACTIVE", "INACTIVE"];
const MOVEMENT_TYPES: FilamentMovementType[] = ["ENTRADA", "AJUSTE", "PERDA", "DEVOLUCAO", "CORRECAO"];

function parseFilamentInput(formData: FormData): FilamentInput {
  const statusRaw = String(formData.get("status") ?? "ACTIVE");
  const status = (FILAMENT_STATUSES as string[]).includes(statusRaw) ? (statusRaw as FilamentStatus) : "ACTIVE";
  const purchaseDateRaw = String(formData.get("purchaseDate") ?? "").trim();

  return {
    name: String(formData.get("name") ?? "").trim(),
    brand: String(formData.get("brand") ?? "").trim() || null,
    material: String(formData.get("material") ?? "").trim(),
    color: String(formData.get("color") ?? "").trim() || null,
    batch: String(formData.get("batch") ?? "").trim() || null,
    supplier: String(formData.get("supplier") ?? "").trim() || null,
    pricePerKg: String(formData.get("pricePerKg") ?? "0") || "0",
    initialWeightGrams: String(formData.get("initialWeightGrams") ?? "0") || "0",
    minStockGrams: String(formData.get("minStockGrams") ?? "0") || "0",
    purchaseDate: purchaseDateRaw ? new Date(purchaseDateRaw) : null,
    location: String(formData.get("location") ?? "").trim() || null,
    status,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createFilamentAction(
  _prevState: FilamentFormState,
  formData: FormData,
): Promise<FilamentFormState> {
  const { userId } = await requirePermission(PERMISSIONS.FILAMENTS_MANAGE);

  const base = parseFilamentInput(formData);
  const input: CreateFilamentInput = {
    ...base,
    availableGrams: String(formData.get("availableGrams") ?? "0") || "0",
  };

  if (!input.name) return { error: "Informe o nome do filamento." };
  if (!input.material) return { error: "Informe o material do filamento." };

  try {
    await createFilament(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/estoque");
  return undefined;
}

export async function updateFilamentAction(
  id: string,
  _prevState: FilamentFormState,
  formData: FormData,
): Promise<FilamentFormState> {
  const { userId } = await requirePermission(PERMISSIONS.FILAMENTS_MANAGE);
  const input = parseFilamentInput(formData);

  if (!input.name) return { error: "Informe o nome do filamento." };
  if (!input.material) return { error: "Informe o material do filamento." };

  try {
    await updateFilament(id, input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/estoque");
  return undefined;
}

export type MovementFormState = { error?: string } | undefined;

export async function recordMovementAction(
  _prevState: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const { userId } = await requirePermission(PERMISSIONS.FILAMENTS_MANAGE);

  const filamentId = String(formData.get("filamentId") ?? "");
  const typeRaw = String(formData.get("type") ?? "");
  const quantityRaw = String(formData.get("quantityGrams") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!filamentId) return { error: "Selecione o filamento." };
  if (!(MOVEMENT_TYPES as string[]).includes(typeRaw)) return { error: "Selecione o tipo de movimentação." };
  if (!quantityRaw) return { error: "Informe a quantidade da movimentação." };

  const input: RecordMovementInput = {
    filamentId,
    type: typeRaw as FilamentMovementType,
    quantityGrams: quantityRaw,
    reason,
  };

  try {
    await recordMovement(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/estoque");
  return undefined;
}
