import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const financialTransaction = { findMany: vi.fn() };
  const inventoryItem = { findMany: vi.fn() };
  const prismaMock: Record<string, unknown> = { financialTransaction, inventoryItem };
  return { prisma: prismaMock };
});

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPotentialInventoryProfit, getRealizedProfit } from "@/modules/finance/services/reports";

const mockedTransaction = vi.mocked(prisma.financialTransaction);
const mockedItem = vi.mocked(prisma.inventoryItem);

function resetMocks() {
  mockedTransaction.findMany.mockReset();
  mockedItem.findMany.mockReset();
}

const d = (v: number) => new Prisma.Decimal(v);

function txWithJob(amount: number, finalPrice: number, directCost: number) {
  return {
    amount: d(amount),
    installment: {
      accountsReceivable: {
        quoteVersion: { job: { finalPrice: d(finalPrice), directCost: d(directCost) } },
      },
    },
  };
}

function txWithoutJob(amount: number) {
  return {
    amount: d(amount),
    installment: {
      accountsReceivable: { quoteVersion: { job: null } },
    },
  };
}

// --- getRealizedProfit — CASO CRÍTICO: por transação, não pelo valor total do orçamento --

describe("getRealizedProfit — calculado por transação, nunca pelo valor total do orçamento", () => {
  beforeEach(resetMocks);

  it("aplica a margem do job SÓ sobre o valor da transação, não sobre finalPrice do job inteiro", async () => {
    // job: finalPrice 1000, directCost 600 -> margem 40%. Uma transação de
    // apenas 500 (metade do orçamento, ex. uma parcela) deve gerar 200 de
    // lucro — NUNCA 400 (que seria a margem sobre os 1000 inteiros).
    mockedTransaction.findMany.mockResolvedValue([txWithJob(500, 1000, 600)] as never);

    const result = await getRealizedProfit();

    expect(result.toString()).toBe("200");
  });

  it("soma corretamente várias transações do mesmo job (pagamentos parciais em momentos diferentes)", async () => {
    mockedTransaction.findMany.mockResolvedValue([
      txWithJob(300, 1000, 600), // margem 0.4 -> 120
      txWithJob(700, 1000, 600), // margem 0.4 -> 280
    ] as never);

    const result = await getRealizedProfit();

    expect(result.toString()).toBe("400");
  });

  it("transação sem job de origem (orçamento manual) contribui ZERO — nunca inventa uma margem", async () => {
    mockedTransaction.findMany.mockResolvedValue([txWithoutJob(1000)] as never);

    const result = await getRealizedProfit();

    expect(result.toString()).toBe("0");
  });

  it("ESTORNO (valor negativo) reduz o lucro realizado na mesma proporção do RECEBIMENTO original", async () => {
    // Um RECEBIMENTO de 500 (lucro +200) seguido do estorno TOTAL dessa
    // mesma transação (-500, lucro -200) deve zerar o lucro reconhecido —
    // dinheiro que saiu do caixa não pode continuar contando como lucro.
    mockedTransaction.findMany.mockResolvedValue([
      txWithJob(500, 1000, 600),
      txWithJob(-500, 1000, 600),
    ] as never);

    const result = await getRealizedProfit();

    expect(result.toString()).toBe("0");
  });

  it("filtra por período quando informado", async () => {
    mockedTransaction.findMany.mockResolvedValue([]);
    const start = new Date("2026-07-01");
    const end = new Date("2026-07-31");

    await getRealizedProfit({ start, end });

    expect(mockedTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transactionDate: { gte: start, lte: end } } }),
    );
  });

  it("sem período, não filtra por data (relatório acumulado)", async () => {
    mockedTransaction.findMany.mockResolvedValue([]);
    await getRealizedProfit();
    expect(mockedTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});

// --- getPotentialInventoryProfit — CASO CRÍTICO: nunca conta itens já vendidos --

describe("getPotentialInventoryProfit — nunca conta itens já vendidos/reservados/descartados", () => {
  beforeEach(resetMocks);

  it("calcula (unitPrice - unitCost) * quantityAvailable para item com job vinculado", async () => {
    // job: finalPrice 1000, quantityProduced 10 -> unitPrice 100/un.
    // unitCost já vem calculado em InventoryItem.unitCost (directCost/qty) = 60/un.
    mockedItem.findMany.mockResolvedValue([
      { quantityAvailable: 4, unitCost: d(60), job: { finalPrice: d(1000), quantityProduced: 10 } },
    ] as never);

    const result = await getPotentialInventoryProfit();

    // (100 - 60) * 4 = 160
    expect(result.toString()).toBe("160");
  });

  it("item sem job de origem (orçamento manual, sem unitCost) contribui ZERO", async () => {
    mockedItem.findMany.mockResolvedValue([{ quantityAvailable: 5, unitCost: null, job: null }] as never);

    const result = await getPotentialInventoryProfit();

    expect(result.toString()).toBe("0");
  });

  it("consulta o banco filtrando quantityAvailable > 0 — itens totalmente vendidos/descartados/reservados nunca chegam a este cálculo", async () => {
    mockedItem.findMany.mockResolvedValue([]);

    await getPotentialInventoryProfit();

    expect(mockedItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { quantityAvailable: { gt: 0 } } }),
    );
  });

  it("soma o potencial de múltiplos itens disponíveis", async () => {
    mockedItem.findMany.mockResolvedValue([
      { quantityAvailable: 2, unitCost: d(60), job: { finalPrice: d(1000), quantityProduced: 10 } }, // (100-60)*2=80
      { quantityAvailable: 3, unitCost: d(30), job: { finalPrice: d(500), quantityProduced: 5 } }, // (100-30)*3=210
    ] as never);

    const result = await getPotentialInventoryProfit();

    expect(result.toString()).toBe("290");
  });
});
