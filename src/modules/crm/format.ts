// Helpers de formatação/apresentação para o Kanban CRM — puros, sem Prisma,
// usáveis em client ou server (mesmo padrão de src/modules/customers/format.ts).
// A regra de negócio "de verdade" (transição, pré-condição) vive em
// services/opportunities.ts; aqui é só como exibir o que já foi decidido lá.

import type { OpportunityPriority, OpportunityStage } from "@prisma/client";

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  PROPOSTA: "Proposta",
  NEGOCIACAO: "Negociação",
  DESENVOLVIMENTO: "Desenvolvimento",
  QUALIDADE: "Teste de Qualidade",
  ENTREGA: "Entrega",
  CONCLUIDO: "Concluído",
};

export const STAGE_COLUMNS: OpportunityStage[] = [
  "PROPOSTA",
  "NEGOCIACAO",
  "DESENVOLVIMENTO",
  "QUALIDADE",
  "ENTREGA",
  "CONCLUIDO",
];

// Próxima etapa no fluxo padrão (avanço). Única fonte da verdade — reutilizada
// pelo backend (services/opportunities.ts, para validar transição) e pela UI
// (botão de fallback "mover para [próxima etapa]" no card).
export const NEXT_STAGE: Record<OpportunityStage, OpportunityStage | null> = {
  PROPOSTA: "NEGOCIACAO",
  NEGOCIACAO: "DESENVOLVIMENTO",
  DESENVOLVIMENTO: "QUALIDADE",
  QUALIDADE: "ENTREGA",
  ENTREGA: "CONCLUIDO",
  CONCLUIDO: null,
};

export const PRIORITY_LABEL: Record<OpportunityPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
};

// Cores semânticas já definidas em globals.css/tailwind.config.ts — nunca só
// cor sem texto (regra da Etapa 4 / DoD), sempre acompanhadas do rótulo acima.
export const PRIORITY_TONE: Record<OpportunityPriority, "neutral" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "danger",
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Dias corridos entre `since` (normalmente o `movedAt` da última entrada de
 * OpportunityStageHistory) e `now` — base de "dias na etapa" (CRM-3).
 */
export function daysSince(since: Date, now: Date = new Date()): number {
  const diff = now.getTime() - new Date(since).getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

export type DeadlineTone = "danger" | "warning" | "success" | "neutral";

export type DeadlineStatus = {
  tone: DeadlineTone;
  label: string;
};

/**
 * Indicador visual de prazo do card (CRM-3: "alerta visual se estiver
 * atrasado"). Sempre retorna cor + texto — nunca só cor, para não depender
 * de percepção de cor sozinha (acessibilidade).
 */
export function getDeadlineStatus(
  deadlineAt: Date | string | null,
  stage: OpportunityStage,
  now: Date = new Date(),
): DeadlineStatus {
  if (stage === "CONCLUIDO") {
    return { tone: "neutral", label: "Concluído" };
  }
  if (!deadlineAt) {
    return { tone: "neutral", label: "Sem prazo definido" };
  }

  const deadline = new Date(deadlineAt);
  const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY);

  if (diffDays < 0) {
    return { tone: "danger", label: `Atrasado ${Math.abs(diffDays)} dia(s)` };
  }
  if (diffDays === 0) {
    return { tone: "warning", label: "Vence hoje" };
  }
  if (diffDays <= 3) {
    return { tone: "warning", label: `Vence em ${diffDays} dia(s)` };
  }
  return { tone: "success", label: `No prazo (${diffDays} dias)` };
}
