// Helpers de formatação/apresentação para o módulo de Produção — puros, sem
// Prisma nem qualquer IO, usáveis em client ou server (mesmo padrão de
// src/modules/crm/format.ts e src/modules/quotes/format.ts). A regra de
// negócio "de verdade" (reserva, conclusão) vive em
// services/production.ts; aqui é só como exibir o que já foi decidido lá.

import type { ProductionPrintStatus } from "@prisma/client";

export const PRINT_STATUS_LABEL: Record<ProductionPrintStatus, string> = {
  AGUARDANDO: "Aguardando",
  IMPRIMINDO: "Imprimindo",
  CONCLUIDA: "Concluída",
  FALHOU: "Falhou",
};

// Sempre cor + texto (nunca só cor) — mesma regra de acessibilidade do
// indicador de prazo do Kanban (src/modules/crm/format.ts) e do orçamento
// (src/modules/quotes/format.ts).
export const PRINT_STATUS_TONE: Record<ProductionPrintStatus, "neutral" | "warning" | "success" | "danger"> = {
  AGUARDANDO: "neutral",
  IMPRIMINDO: "warning",
  CONCLUIDA: "success",
  FALHOU: "danger",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Limiar de "próximo do vencimento" para a ordem de produção: ≤ 2 dias
// corridos até `plannedEndAt`. Escolha deliberada (documentada aqui, não só
// em comentário de planejamento): o Kanban comercial (CRM-3,
// src/modules/crm/format.ts) usa ≤ 3 dias porque lida com prazos de venda,
// que dão mais margem de reação; o prazo de uma ordem de produção é
// operacional e normalmente medido em poucos dias de impressão — um limiar
// mais apertado (2 dias) evita alertar cedo demais mas ainda dá tempo do
// Operador reagir (reprogramar impressora, priorizar fila) antes de atrasar.
export const PRODUCTION_DUE_SOON_THRESHOLD_DAYS = 2;

export type ProductionDeadlineCounter = "NO_PRAZO" | "PROXIMO_VENCIMENTO" | "ATRASADO";

/**
 * Contador de prazo da ordem de produção (PROD-2/PROD-3) — função pura, sem
 * IO, sem acesso a banco: recebe `plannedEndAt` e a data de referência
 * (default: agora) e devolve um dos três estados. NUNCA armazenado no banco
 * — é sempre recalculado no momento de exibir (mesma filosofia do "status de
 * prazo calculado, não digitado" da Etapa 1 §11).
 */
export function getProductionDeadlineCounter(
  plannedEndAt: Date | string,
  now: Date = new Date(),
): ProductionDeadlineCounter {
  const end = new Date(plannedEndAt);
  const diffDays = Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY);

  if (diffDays < 0) return "ATRASADO";
  if (diffDays <= PRODUCTION_DUE_SOON_THRESHOLD_DAYS) return "PROXIMO_VENCIMENTO";
  return "NO_PRAZO";
}

export type ProductionDeadlineStatus = {
  tone: "danger" | "warning" | "success" | "neutral";
  label: string;
};

/**
 * Wrapper de exibição sobre `getProductionDeadlineCounter` — sempre cor +
 * texto, trata o caso de `plannedEndAt` ainda não definido (ordem recém
 * criada, sem data prevista de término) e o caso de ordem já concluída
 * (prazo deixa de ser relevante, mostra só o rótulo neutro).
 */
export function getProductionDeadlineStatus(
  plannedEndAt: Date | string | null,
  printStatus: ProductionPrintStatus,
  now: Date = new Date(),
): ProductionDeadlineStatus {
  if (printStatus === "CONCLUIDA") {
    return { tone: "neutral", label: "Concluída" };
  }
  if (!plannedEndAt) {
    return { tone: "neutral", label: "Sem prazo previsto definido" };
  }

  const counter = getProductionDeadlineCounter(plannedEndAt, now);
  switch (counter) {
    case "ATRASADO":
      return { tone: "danger", label: "Atrasado" };
    case "PROXIMO_VENCIMENTO":
      return { tone: "warning", label: "Próximo do vencimento" };
    case "NO_PRAZO":
      return { tone: "success", label: "No prazo" };
  }
}
