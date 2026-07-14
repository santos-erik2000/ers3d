// Financeiro — fluxo de caixa simples (Sprint 9, épico E8, história FIN-3:
// "Como Contador, quero ver fluxo de caixa e contas a receber sem poder
// editar nada"). Separa explicitamente dois números que o briefing original
// insiste em nunca confundir: dinheiro que JÁ ENTROU de fato no caixa versus
// valor ainda ESPERADO — por isso os nomes dos campos de retorno são
// inequívocos (`receitaRecebida` vs. `receitaPrevista`), nunca um campo
// genérico "receita".

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type CashflowPeriod = { start: Date; end: Date };

export type CashflowResult = {
  periodStart: Date;
  periodEnd: Date;
  // Dinheiro que DE FATO entrou (ou saiu, via estorno) no caixa dentro do
  // período — soma de `FinancialTransaction.amount` (RECEBIMENTO positivo
  // menos ESTORNO, que já é gravado negativo) filtrado por `transactionDate`
  // dentro do período. Isto é caixa real — nunca confundir com
  // `receitaPrevista` abaixo.
  receitaRecebida: Prisma.Decimal;
  // Saldo AINDA NÃO recebido das contas a receber em aberto (status
  // PREVISTO/PENDENTE/PARCIALMENTE_PAGO) — é uma EXPECTATIVA, não caixa. Soma
  // o SALDO RESTANTE de cada parcela (`amount - amountPaid`), não o valor
  // total negociado, para não contar de novo, aqui, dinheiro que uma conta
  // parcialmente paga já registrou em `receitaRecebida`. Este número é um
  // retrato do momento (contas ainda em aberto agora), não filtrado pelo
  // período — diferente de `receitaRecebida`, que é sempre um recorte de
  // tempo (o que entrou NAQUELE período).
  receitaPrevista: Prisma.Decimal;
};

export async function getCashflow(period: CashflowPeriod): Promise<CashflowResult> {
  const transactions = await prisma.financialTransaction.findMany({
    where: { transactionDate: { gte: period.start, lte: period.end } },
    select: { amount: true },
  });
  const receitaRecebida = transactions.reduce((sum, t) => sum.plus(t.amount), new Prisma.Decimal(0));

  const openReceivables = await prisma.accountsReceivable.findMany({
    where: { status: { in: ["PREVISTO", "PENDENTE", "PARCIALMENTE_PAGO"] } },
    include: { installments: true },
  });
  const receitaPrevista = openReceivables.reduce((sum, ar) => {
    const outstanding = ar.installments.reduce((s, i) => s.plus(i.amount.minus(i.amountPaid)), new Prisma.Decimal(0));
    return sum.plus(outstanding);
  }, new Prisma.Decimal(0));

  return { periodStart: period.start, periodEnd: period.end, receitaRecebida, receitaPrevista };
}
