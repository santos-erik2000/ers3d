// Helpers de formatação/apresentação para o módulo de Qualidade (Sprint 7 —
// épico E6). Mesmo padrão de src/modules/crm/format.ts e
// src/modules/production/format.ts: puro, sem Prisma/IO, usável em client ou
// server. A regra de negócio "de verdade" (motivo obrigatório, retrabalho)
// vive em services/quality.ts; aqui é só como exibir o que já foi decidido lá.

import type { QualityCheckResult } from "@prisma/client";

/**
 * Itens fixos do checklist de qualidade (QUAL-1). Um checklist "configurável
 * de verdade" (item variável por tipo de peça/cliente) é um refinamento
 * futuro, fora de escopo do Sprint 7 — hoje todo QualityCheck roda contra
 * esta mesma lista fixa, na mesma ordem, usada tanto pelo formulário quanto
 * pela Server Action que o processa (src/modules/quality/actions.ts).
 */
export const QUALITY_CHECKLIST_ITEMS = [
  "Dimensões",
  "Integridade estrutural",
  "Cor",
  "Acabamento",
  "Resistência",
  "Encaixe",
  "Quantidade",
  "Personalização",
  "Limpeza",
  "Embalagem",
] as const;

export const QUALITY_RESULT_LABEL: Record<QualityCheckResult, string> = {
  APROVADO: "Aprovado",
  APROVADO_COM_RESSALVA: "Aprovado com ressalva",
  REPROVADO: "Reprovado",
};

// Cores semânticas já definidas em globals.css/tailwind.config.ts — nunca só
// cor sem texto (regra da Etapa 4 / DoD), sempre acompanhadas do rótulo
// acima: sucesso=verde (aprovado), atenção=amarelo (ressalva), erro=vermelho
// (reprovado).
export const QUALITY_RESULT_TONE: Record<QualityCheckResult, "success" | "warning" | "danger"> = {
  APROVADO: "success",
  APROVADO_COM_RESSALVA: "warning",
  REPROVADO: "danger",
};
