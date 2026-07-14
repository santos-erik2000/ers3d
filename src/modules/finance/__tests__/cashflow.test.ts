import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const financialTransaction = { findMany: vi.fn() };
  const accountsReceivable = { findMany: vi.fn() };
  const prismaMock: Record<string, unknown> = { financialTransaction, accountsReceivable };
  return { prisma: prismaMock };
});

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCashflow } from "@/modules/finance/services/cashflow";

const mockedTransaction = vi.mocked(prisma.financialTransaction);
const mockedAr = vi.mocked(prisma.accountsReceivable);

function resetMocks() {
  mockedTransaction.findMany.mockReset();
  mockedAr.findMany.mockReset();
}

const d = (v: number) => new Prisma.Decimal(v);

describe("getCashflow — receitaRecebida vs. receitaPrevista nunca são o mesmo número", () => {
  beforeEach(resetMocks);

  it("receitaRecebida soma RECEBIMENTO menos ESTORNO (que já é negativo) dentro do período", async () => {
    mockedTransaction.findMany.mockResolvedValue([{ amount: d(500) }, { amount: d(-200) }] as never);
    mockedAr.findMany.mockResolvedValue([]);

    const result = await getCashflow({ start: new Date("2026-07-01"), end: new Date("2026-07-31") });

    expect(result.receitaRecebida.toString()).toBe("300");
  });

  it("receitaPrevista soma o SALDO RESTANTE (não o valor total) das contas em aberto, para não contar de novo o que já é receitaRecebida", async () => {
    mockedTransaction.findMany.mockResolvedValue([]);
    mockedAr.findMany.mockResolvedValue([
      {
        status: "PARCIALMENTE_PAGO",
        installments: [
          { amount: d(500), amountPaid: d(200) }, // saldo 300
          { amount: d(300), amountPaid: d(0) }, // saldo 300
        ],
      },
    ] as never);

    const result = await getCashflow({ start: new Date("2026-07-01"), end: new Date("2026-07-31") });

    // 300 + 300 = 600, nunca 800 (que seria o valor total das duas parcelas).
    expect(result.receitaPrevista.toString()).toBe("600");
  });

  it("consulta AccountsReceivable filtrando só os status em aberto (PREVISTO/PENDENTE/PARCIALMENTE_PAGO)", async () => {
    mockedTransaction.findMany.mockResolvedValue([]);
    mockedAr.findMany.mockResolvedValue([]);

    await getCashflow({ start: new Date("2026-07-01"), end: new Date("2026-07-31") });

    expect(mockedAr.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["PREVISTO", "PENDENTE", "PARCIALMENTE_PAGO"] } } }),
    );
  });

  it("os dois campos de retorno são nomes inequívocos, nunca um campo genérico 'receita'", async () => {
    mockedTransaction.findMany.mockResolvedValue([]);
    mockedAr.findMany.mockResolvedValue([]);

    const result = await getCashflow({ start: new Date("2026-07-01"), end: new Date("2026-07-31") });

    expect(result).toHaveProperty("receitaRecebida");
    expect(result).toHaveProperty("receitaPrevista");
    expect(result).not.toHaveProperty("receita");
  });
});
