// Helpers de formatação/apresentação para o orçamento — puros, sem Prisma,
// usáveis em client ou server (mesmo padrão de src/modules/crm/format.ts).

import type { QuoteStatus } from "@prisma/client";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

// Sempre cor + texto (nunca só cor) — mesma regra de acessibilidade do
// indicador de prazo do Kanban (src/modules/crm/format.ts).
export const QUOTE_STATUS_TONE: Record<QuoteStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENT: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: unknown): string {
  const numeric = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}
