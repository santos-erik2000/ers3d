// Motor de precificação da calculadora 3D (Sprint 4 — épico E4, histórias
// CALC-1..CALC-3). Função pura, sem Prisma/IO: recebe entradas já resolvidas
// (preço/kg de cada filamento já buscado no banco pelo chamador) e devolve o
// resultado — ou uma rejeição, nunca lança exceção para o caso de negócio
// esperado (soma de percentuais ≥ 100%), que é o caso crítico explícito da
// Etapa 2, seção 05.
//
// Fórmula (Etapa 1, seção 10 do brief original — reproduzida aqui ao pé da
// letra, sem simplificar):
//
//   custo_de_cada_filamento = (preço_por_kg / 1000) × gramas_usadas
//   custo_total_filamentos  = soma do custo de todos os filamentos do job
//   consumo_kwh             = (potência_watts / 1000) × horas_impressão
//   custo_energia           = consumo_kwh × preço_kwh
//   custo_direto            = custo_total_filamentos + custo_energia
//
//   soma_percentuais = manutenção% + segurança% + lucro%   (fração 0-1)
//
//   REGRA DE SEGURANÇA — se soma_percentuais >= 1 (>= 100%), REJEITAR.
//
//   preço_final = custo_direto / (1 - soma_percentuais)
//   valor_manutencao = preço_final × manutenção%
//   valor_seguranca  = preço_final × segurança%
//   valor_lucro      = preço_final × lucro%
//
// Todo valor é Prisma.Decimal do início ao fim — nunca Number()/float em
// nenhum ponto do cálculo, mesmo intermediário.

import { Prisma } from "@prisma/client";

export const CALC_RULE_VERSION = "v1";

const MONEY_DECIMALS = 2;

// Arredondamento financeiro: "half up" (ex.: 12.505 → 12.51), decidido uma
// única vez aqui. É o modo mais previsível para conferência manual (o padrão
// do Decimal.js, "half even"/banker's rounding, arredondaria 12.505 → 12.50
// e confundiria quem está batendo o orçamento de cabeça). Aplicado só nos
// valores finais exibidos/persistidos — nunca em somas intermediárias
// (ex.: soma de custo de cada filamento, consumo de kWh), para não acumular
// erro de arredondamento ao longo da conta.
const ROUNDING_MODE = Prisma.Decimal.ROUND_HALF_UP;

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DECIMALS, ROUNDING_MODE);
}

function toDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  if (decimal.isNaN()) throw new Error("not a number");
  return decimal;
}

export type PricingFilamentInput = {
  filamentId: string;
  pricePerKg: Prisma.Decimal.Value;
  gramsUsed: Prisma.Decimal.Value;
};

export type PricingInput = {
  filaments: PricingFilamentInput[];
  powerWatts: Prisma.Decimal.Value;
  printHours: Prisma.Decimal.Value;
  kwhPrice: Prisma.Decimal.Value;
  // Fração 0-1 (20% = 0.20). A conversão de "20" digitado pelo usuário para
  // 0.20 acontece na camada de action/UI (src/modules/jobs/actions.ts) —
  // este motor nunca recebe/aceita um valor 0-100.
  maintenancePct: Prisma.Decimal.Value;
  safetyPct: Prisma.Decimal.Value;
  profitPct: Prisma.Decimal.Value;
};

export type PricingFilamentResult = {
  filamentId: string;
  gramsUsed: Prisma.Decimal;
  pricePerKg: Prisma.Decimal;
  /** custo_de_cada_filamento, já arredondado para exibição. */
  cost: Prisma.Decimal;
};

export type PricingResult = {
  rejected: false;
  ruleVersion: typeof CALC_RULE_VERSION;
  filaments: PricingFilamentResult[];
  filamentsCost: Prisma.Decimal;
  energyCost: Prisma.Decimal;
  directCost: Prisma.Decimal;
  /** Soma dos três percentuais, fração 0-1 — informativo (não é dinheiro, não é arredondado). */
  percentSum: Prisma.Decimal;
  finalPrice: Prisma.Decimal;
  maintenanceValue: Prisma.Decimal;
  safetyValue: Prisma.Decimal;
  profitValue: Prisma.Decimal;
};

export type PricingRejection = {
  rejected: true;
  reason: string;
};

/**
 * Calcula o preço final de um job de impressão 3D. Retorna `{ rejected: true,
 * reason }` em qualquer entrada inválida — nunca lança exceção para os casos
 * de negócio esperados, para que o chamador (service/action) decida como
 * apresentar o erro. O caso crítico é `percentSum >= 1`: quando isso ocorre,
 * NADA além da soma é calculado (não computa preço_final, não divide por
 * zero/negativo) — ver Etapa 2, seção 05, critério "Rejeitar cálculo quando
 * percentuais somam 100% ou mais" (CALC-3).
 */
export function calculatePrice(input: PricingInput): PricingResult | PricingRejection {
  if (!input.filaments || input.filaments.length === 0) {
    return { rejected: true, reason: "Selecione ao menos um filamento com gramas utilizadas." };
  }

  let powerWatts: Prisma.Decimal;
  let printHours: Prisma.Decimal;
  let kwhPrice: Prisma.Decimal;
  let maintenancePct: Prisma.Decimal;
  let safetyPct: Prisma.Decimal;
  let profitPct: Prisma.Decimal;
  try {
    powerWatts = toDecimal(input.powerWatts);
    printHours = toDecimal(input.printHours);
    kwhPrice = toDecimal(input.kwhPrice);
    maintenancePct = toDecimal(input.maintenancePct);
    safetyPct = toDecimal(input.safetyPct);
    profitPct = toDecimal(input.profitPct);
  } catch {
    return { rejected: true, reason: "Potência, horas, preço do kWh ou percentuais inválidos." };
  }

  if (powerWatts.lessThan(0)) return { rejected: true, reason: "Potência (watts) não pode ser negativa." };
  if (printHours.lessThan(0)) {
    return { rejected: true, reason: "Horas de impressão não podem ser negativas." };
  }
  if (kwhPrice.lessThan(0)) return { rejected: true, reason: "Preço do kWh não pode ser negativo." };
  if (maintenancePct.lessThan(0) || safetyPct.lessThan(0) || profitPct.lessThan(0)) {
    return { rejected: true, reason: "Percentuais de manutenção, segurança e lucro não podem ser negativos." };
  }

  const filamentResults: PricingFilamentResult[] = [];
  // custo_total_filamentos acumulado SEM arredondar cada parcela — só o total
  // final é arredondado, para não acumular erro de arredondamento por item.
  let filamentsCostRaw = new Prisma.Decimal(0);

  for (const entry of input.filaments) {
    let pricePerKg: Prisma.Decimal;
    let gramsUsed: Prisma.Decimal;
    try {
      pricePerKg = toDecimal(entry.pricePerKg);
      gramsUsed = toDecimal(entry.gramsUsed);
    } catch {
      return { rejected: true, reason: "Preço por kg ou gramas utilizadas inválidos em um dos filamentos." };
    }
    if (pricePerKg.lessThan(0)) {
      return { rejected: true, reason: "Preço por kg de um dos filamentos não pode ser negativo." };
    }
    if (gramsUsed.lessThanOrEqualTo(0)) {
      return {
        rejected: true,
        reason: "As gramas utilizadas de cada filamento selecionado devem ser maiores que zero.",
      };
    }

    // custo_de_cada_filamento = (preço_por_kg / 1000) × gramas_usadas
    const cost = pricePerKg.dividedBy(1000).times(gramsUsed);
    filamentsCostRaw = filamentsCostRaw.plus(cost);
    filamentResults.push({
      filamentId: entry.filamentId,
      gramsUsed,
      pricePerKg,
      cost: money(cost),
    });
  }

  // consumo_kwh = (potência_watts / 1000) × horas_impressão
  const consumoKwh = powerWatts.dividedBy(1000).times(printHours);
  // custo_energia = consumo_kwh × preço_kwh
  const energyCostRaw = consumoKwh.times(kwhPrice);

  // custo_direto = custo_total_filamentos + custo_energia
  const directCostRaw = filamentsCostRaw.plus(energyCostRaw);

  // soma_percentuais = manutenção% + segurança% + lucro%
  const percentSum = maintenancePct.plus(safetyPct).plus(profitPct);

  // REGRA DE SEGURANÇA (CALC-3, caso crítico da Etapa 2 §05): >= 100% rejeita
  // e não calcula mais nada (não faz sentido dividir por zero/negativo).
  if (percentSum.greaterThanOrEqualTo(1)) {
    return {
      rejected: true,
      reason:
        `A soma de manutenção + segurança + lucro (${percentSum.times(100).toFixed(2)}%) precisa ser ` +
        "inferior a 100%. Ajuste os percentuais antes de calcular.",
    };
  }

  // preço_final = custo_direto / (1 - soma_percentuais)
  const finalPriceRaw = directCostRaw.dividedBy(new Prisma.Decimal(1).minus(percentSum));

  const maintenanceValueRaw = finalPriceRaw.times(maintenancePct);
  const safetyValueRaw = finalPriceRaw.times(safetyPct);
  const profitValueRaw = finalPriceRaw.times(profitPct);

  return {
    rejected: false,
    ruleVersion: CALC_RULE_VERSION,
    filaments: filamentResults,
    filamentsCost: money(filamentsCostRaw),
    energyCost: money(energyCostRaw),
    directCost: money(directCostRaw),
    percentSum,
    finalPrice: money(finalPriceRaw),
    maintenanceValue: money(maintenanceValueRaw),
    safetyValue: money(safetyValueRaw),
    profitValue: money(profitValueRaw),
  };
}
