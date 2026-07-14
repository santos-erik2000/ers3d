// Helpers de formatação/apresentação para o módulo de Entrega (Sprint 8 —
// épico E7). Mesmo padrão de src/modules/quality/format.ts e
// src/modules/production/format.ts: puro, sem Prisma/IO, usável em client ou
// server. A regra de negócio "de verdade" vive em services/deliveries.ts;
// aqui é só como exibir o que já foi decidido lá.

import type { DeliveryMethod, DeliveryStatus } from "@prisma/client";

/**
 * Itens fixos do checklist de embalagem (DEL-1) — mesma decisão de escopo de
 * QUALITY_CHECKLIST_ITEMS (src/modules/quality/format.ts): uma lista fixa
 * hoje, configurável por tipo de peça/cliente é refinamento futuro. Criados
 * junto da Delivery (src/modules/deliveries/services/deliveries.ts,
 * `createDelivery`), todos desmarcados até o usuário confirmar cada um.
 */
export const DELIVERY_CHECKLIST_ITEMS = [
  "Conferência da peça",
  "Quantidade",
  "Acabamento",
  "Proteção",
  "Identificação",
  "Peso",
  "Dimensões",
  "Foto da embalagem",
] as const;

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = {
  RETIRADA: "Retirada pelo cliente",
  ENTREGA_PROPRIA: "Entrega própria",
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
  MOTOBOY: "Motoboy",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDENTE: "Pendente",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
};

// Sempre cor + texto (nunca só cor) — mesma regra de acessibilidade já usada
// em todos os indicadores de status do projeto.
export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, "neutral" | "warning" | "success"> = {
  PENDENTE: "neutral",
  ENVIADO: "warning",
  ENTREGUE: "success",
};
