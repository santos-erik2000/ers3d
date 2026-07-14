"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  adjustItem,
  discardItem,
  releaseReservation,
  reserveItem,
  sellItem,
} from "@/modules/inventory/services/inventory";

export type InventoryFormState = { error?: string } | undefined;

const OPERATIONS = ["RESERVAR", "LIBERAR", "VENDER", "DESCARTAR", "AJUSTAR"] as const;
type Operation = (typeof OPERATIONS)[number];

/**
 * Uma única Server Action para as cinco operações manuais de estoque de
 * peças (reservar/liberar reserva/vender/descartar/ajustar) — despachada
 * pelo campo `operation`, mesmo padrão de `submitQualityCheckAction`
 * despachar por `result` (src/modules/quality/actions.ts). Reduz a UI a um
 * formulário por item (src/app/(app)/crm/[id]/inventory-panel.tsx) em vez de
 * cinco formulários separados. A checagem de saldo suficiente (INV-2, "Venda
 * ou descarte sem estoque") acontece sempre dentro do serviço
 * (`recordInventoryMovementInTx`), nunca aqui.
 */
export async function recordInventoryMovementAction(
  _prevState: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const { userId } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);

  const inventoryItemId = String(formData.get("inventoryItemId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!inventoryItemId) return { error: "Item de estoque não informado." };

  const operationRaw = String(formData.get("operation") ?? "");
  if (!OPERATIONS.includes(operationRaw as Operation)) {
    return { error: "Selecione uma operação válida." };
  }
  const operation = operationRaw as Operation;

  const quantity = Number(String(formData.get("quantity") ?? "").trim());
  const reason = String(formData.get("reason") ?? "").trim() || null;

  try {
    switch (operation) {
      case "RESERVAR":
        await reserveItem(inventoryItemId, quantity, userId, reason);
        break;
      case "LIBERAR":
        await releaseReservation(inventoryItemId, quantity, userId, reason);
        break;
      case "VENDER":
        await sellItem(inventoryItemId, quantity, userId, reason);
        break;
      case "DESCARTAR":
        await discardItem(inventoryItemId, quantity, userId, reason);
        break;
      case "AJUSTAR":
        if (!reason) return { error: "Informe a justificativa do ajuste." };
        await adjustItem(inventoryItemId, quantity, userId, reason);
        break;
    }
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  if (opportunityId) revalidatePath(`/crm/${opportunityId}`);
  revalidatePath("/estoque-pecas");
  return undefined;
}
