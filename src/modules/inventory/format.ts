// Helpers de formatação/apresentação para o módulo de Estoque de peças
// (Sprint 8 — épico E7) — puros, sem Prisma/IO, usáveis em client ou server
// (mesmo padrão de src/modules/filaments/format.ts). A regra de negócio "de
// verdade" vive em services/inventory.ts; aqui é só como exibir o que já foi
// decidido lá.

import type { InventoryItemStatus, InventoryMovementType } from "@prisma/client";

export const MOVEMENT_TYPE_LABEL: Record<InventoryMovementType, string> = {
  PRODUCAO: "Produção",
  RESERVA: "Reserva",
  LIBERACAO_RESERVA: "Liberação de reserva",
  VENDA: "Venda",
  DESCARTE: "Descarte",
  AJUSTE: "Ajuste",
};

export const INVENTORY_STATUS_LABEL: Record<InventoryItemStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "object" ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}
