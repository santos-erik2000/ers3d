"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  createCustomer,
  updateCustomer,
  type CustomerInput,
  type DuplicateMatch,
} from "@/modules/customers/services/customers";
import type { CustomerType } from "@prisma/client";

export type CustomerFormState =
  | {
      error?: string;
      duplicates?: DuplicateMatch[];
    }
  | undefined;

function parseInput(formData: FormData): CustomerInput {
  const tagsRaw = String(formData.get("tags") ?? "");
  return {
    name: String(formData.get("name") ?? "").trim(),
    type: (String(formData.get("type") ?? "PF") as CustomerType) === "PJ" ? "PJ" : "PF",
    document: String(formData.get("document") ?? "") || null,
    email: String(formData.get("email") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    whatsapp: String(formData.get("whatsapp") ?? "") || null,
    address: String(formData.get("address") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    state: String(formData.get("state") ?? "") || null,
    zipCode: String(formData.get("zipCode") ?? "") || null,
    origin: String(formData.get("origin") ?? "") || null,
    segment: String(formData.get("segment") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
    tags: tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    ownerId: String(formData.get("ownerId") ?? "") || null,
    companyName: String(formData.get("companyName") ?? "") || null,
  };
}

export async function createCustomerAction(
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const { userId } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);

  const input = parseInput(formData);
  const confirmedDuplicate = formData.get("confirmedDuplicate") === "true";

  if (!input.name) return { error: "Informe o nome do cliente." };

  try {
    const result = await createCustomer({ ...input, confirmedDuplicate }, userId);
    if (result.status === "duplicate") {
      return { duplicates: result.duplicates };
    }
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/clientes");
  return undefined;
}

export async function updateCustomerAction(
  customerId: string,
  _prevState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const { userId } = await requirePermission(PERMISSIONS.CUSTOMERS_MANAGE);

  const input = parseInput(formData);
  if (!input.name) return { error: "Informe o nome do cliente." };

  try {
    await updateCustomer(customerId, input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
  return undefined;
}
