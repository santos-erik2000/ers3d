// Financeiro — relatórios de lucro (Sprint 9, épico E8, história FIN-4:
// "Como Admin, quero ver lucro realizado separado do lucro potencial em
// estoque"). Este é o ponto mais sensível do sprint conceitualmente — o
// briefing original pede para NUNCA confundir os dois, mas não dá uma
// fórmula fechada (diferente da calculadora de precificação, que tem
// src/modules/jobs/services/pricing.ts como fonte única). As fórmulas abaixo
// são uma DECISÃO DE PRODUTO explícita e revisável, documentada ao pé da
// letra em cada função — não uma verdade matemática única possível.
//
// `getRealizedProfit`/`getPotentialInventoryProfit` alimentam o Dashboard do
// Sprint 10 (ainda não implementado) — por isso a clareza aqui importa para
// quem for construir aquilo depois.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type ProfitPeriod = { start: Date; end: Date };

/**
 * LUCRO REALIZADO (FIN-4).
 *
 * Para cada `FinancialTransaction` (RECEBIMENTO com valor positivo OU
 * ESTORNO com valor negativo — ver nota abaixo), aplica-se a margem do
 * orçamento de origem sobre o valor da PRÓPRIA transação, nunca sobre o
 * valor total do orçamento:
 *
 *   margem = (job.finalPrice - job.directCost) / job.finalPrice
 *   lucroDaTransacao = valorDaTransacao × margem
 *   lucroRealizado = Σ lucroDaTransacao, para toda transação no período
 *
 * A cadeia de origem é `FinancialTransaction → installment →
 * accountsReceivable → quoteVersion → job`. O lucro só é reconhecido na
 * proporção EXATA do que já entrou de fato no caixa — nunca antes disso,
 * nunca pelo valor total do orçamento aprovado (esse seria lucro POTENCIAL,
 * não realizado — ver `getPotentialInventoryProfit` abaixo para a distinção).
 *
 * DECISÃO EXPLÍCITA sobre ESTORNO: a soma inclui tanto RECEBIMENTO quanto
 * ESTORNO (o valor de uma transação ESTORNO já é gravado negativo no banco —
 * ver src/modules/finance/services/receivables.ts, `reverseTransaction`).
 * Isso é deliberado: se um pagamento é revertido, o dinheiro deixou de estar
 * de fato no caixa, então o lucro reconhecido sobre ele também precisa
 * reverter — do contrário este relatório continuaria contando lucro sobre
 * dinheiro que não está mais na empresa, violando a própria regra que motiva
 * a existência desta função ("lucro só na proporção do que está em caixa").
 *
 * TODO (limitação documentada, não inventamos o número): quando a
 * QuoteVersion de origem é MANUAL (sem Job — orçamento sem custo calculado),
 * a margem é desconhecida — essas transações contam lucro realizado ZERO,
 * nunca um valor estimado.
 */
export async function getRealizedProfit(period?: ProfitPeriod): Promise<Prisma.Decimal> {
  const transactions = await prisma.financialTransaction.findMany({
    where: period ? { transactionDate: { gte: period.start, lte: period.end } } : undefined,
    select: {
      amount: true,
      installment: {
        select: {
          accountsReceivable: {
            select: {
              quoteVersion: {
                select: { job: { select: { finalPrice: true, directCost: true } } },
              },
            },
          },
        },
      },
    },
  });

  return transactions.reduce((total, transaction) => {
    const job = transaction.installment.accountsReceivable.quoteVersion.job;
    // Sem job de origem (orçamento manual) ou preço final zero (evita divisão
    // por zero): margem desconhecida — contribui 0, nunca um valor inventado.
    if (!job || job.finalPrice.isZero()) return total;
    const margin = job.finalPrice.minus(job.directCost).dividedBy(job.finalPrice);
    return total.plus(transaction.amount.times(margin));
  }, new Prisma.Decimal(0));
}

/**
 * LUCRO POTENCIAL EM ESTOQUE (FIN-4).
 *
 * Para cada `InventoryItem` com `quantityAvailable > 0`:
 *
 *   potencialDoItem = (unitPrice - unitCost) × quantityAvailable
 *   lucroPotencial = Σ potencialDoItem
 *
 * `unitPrice`/`unitCost` vêm do `Job` vinculado à peça QUANDO HOUVER:
 *   - unitPrice = job.finalPrice / job.quantityProduced (preço de tabela por
 *     unidade — o que a empresa cobraria por ela, não o que já foi cobrado).
 *   - unitCost = InventoryItem.unitCost, que já é job.directCost /
 *     quantityProduced, calculado e persistido na criação do item (ver
 *     src/modules/inventory/services/inventory.ts,
 *     `createInventoryItemFromProductionInTx`).
 *
 * Item SEM job de origem (orçamento manual — `unitCost` nulo, mesma
 * limitação já documentada em `InventoryItem`) entra com potencial ZERO —
 * não há preço de tabela nem custo confiável para estimar; não inventamos
 * esse número.
 *
 * ISTO É SÓ UMA ESTIMATIVA do que PODE virar lucro SE o estoque disponível
 * for vendido pelo preço de tabela — NUNCA exibir como saldo disponível ou
 * como dinheiro em caixa (é exatamente o oposto do lucro realizado acima).
 * Peças já vendidas/reservadas/descartadas (fora de `quantityAvailable`)
 * NUNCA entram nesta soma — só o que ainda pode ser vendido.
 */
export async function getPotentialInventoryProfit(): Promise<Prisma.Decimal> {
  const items = await prisma.inventoryItem.findMany({
    where: { quantityAvailable: { gt: 0 } },
    select: {
      quantityAvailable: true,
      unitCost: true,
      job: { select: { finalPrice: true, quantityProduced: true } },
    },
  });

  return items.reduce((total, item) => {
    // Sem job de origem OU sem custo unitário calculado: potencial zero,
    // documentado — nunca inventamos preço/custo que o sistema não conhece.
    if (!item.job || !item.unitCost) return total;
    const unitPrice = item.job.finalPrice.dividedBy(item.job.quantityProduced);
    const perUnitProfit = unitPrice.minus(item.unitCost);
    return total.plus(perUnitProfit.times(item.quantityAvailable));
  }, new Prisma.Decimal(0));
}
