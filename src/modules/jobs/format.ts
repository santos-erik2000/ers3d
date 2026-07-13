// Helpers de formatação/apresentação da calculadora de precificação — puros,
// sem Prisma, usáveis em client ou server (mesmo padrão de src/modules/crm/format.ts).

import type { ProjectStatus } from "@prisma/client";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANEJAMENTO: "Planejamento",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: unknown): string {
  const numeric = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}

/**
 * Converte a fração armazenada (0.2000) para o percentual exibido ao usuário
 * ("20,00%") — o inverso da conversão feita em src/modules/jobs/actions.ts ao
 * receber o formulário. Nunca mostrar a fração crua (0.2) na UI.
 */
export function formatPercent(value: unknown): string {
  const numeric = typeof value === "object" && value !== null ? Number(value.toString()) : Number(value);
  if (Number.isNaN(numeric)) return "0,00%";
  return `${(numeric * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
