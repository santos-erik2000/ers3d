// Helpers de formatação/apresentação do módulo de Filamentos — puros, sem
// Prisma, usáveis em client ou server (mesmo padrão de src/modules/crm/format.ts).

import type { FilamentMovementType, FilamentStatus } from "@prisma/client";

export const MOVEMENT_TYPE_LABEL: Record<FilamentMovementType, string> = {
  ENTRADA: "Entrada",
  AJUSTE: "Ajuste",
  PERDA: "Perda",
  DEVOLUCAO: "Devolução",
  CORRECAO: "Correção",
};

// Tipos cujo campo de quantidade é sempre um valor positivo digitado pelo
// usuário (o sinal já é implícito no tipo) — usado pela UI para decidir se
// mostra "quantidade" simples ou um campo que aceita negativo (Ajuste/Correção).
export const FIXED_SIGN_MOVEMENT_TYPES: FilamentMovementType[] = ["ENTRADA", "DEVOLUCAO", "PERDA"];

export const FILAMENT_STATUS_LABEL: Record<FilamentStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

const gramsFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatGrams(value: unknown): string {
  const numeric = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return "0,00 g";
  return `${gramsFormatter.format(numeric)} g`;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: unknown): string {
  const numeric = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}
