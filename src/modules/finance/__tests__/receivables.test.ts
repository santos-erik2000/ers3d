import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const accountsReceivable = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  };
  const paymentInstallment = {
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const financialTransaction = {
    create: vi.fn(),
    findUnique: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { accountsReceivable, paymentInstallment, financialTransaction };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  createAccountsReceivableInTx,
  recordPayment,
  reverseTransaction,
  splitInstallments,
} from "@/modules/finance/services/receivables";

const mockedAr = vi.mocked(prisma.accountsReceivable);
const mockedInstallment = vi.mocked(prisma.paymentInstallment);
const mockedTransaction = vi.mocked(prisma.financialTransaction);

function resetMocks() {
  mockedAr.create.mockReset();
  mockedAr.findUnique.mockReset();
  mockedAr.update.mockReset();
  mockedAr.findFirst.mockReset();
  mockedAr.findMany.mockReset();
  mockedInstallment.create.mockReset();
  mockedInstallment.update.mockReset();
  mockedInstallment.deleteMany.mockReset();
  mockedInstallment.findUnique.mockReset();
  mockedTransaction.create.mockReset();
  mockedTransaction.findUnique.mockReset();
  vi.mocked(recordAudit).mockReset();
}

const d = (v: number) => new Prisma.Decimal(v);

// --- createAccountsReceivableInTx (FIN-1) -----------------------------------

describe("createAccountsReceivableInTx — CASO CRÍTICO: nasce sempre em PREVISTO", () => {
  beforeEach(resetMocks);

  it("cria a AccountsReceivable com status PREVISTO (nunca PAGO) e uma parcela inicial cobrindo o valor total", async () => {
    mockedAr.create.mockResolvedValue({ id: "ar1", status: "PREVISTO" } as never);
    mockedInstallment.create.mockResolvedValue({ id: "inst1" } as never);

    const result = await createAccountsReceivableInTx(
      prisma as never,
      {
        opportunityId: "op1",
        quoteVersionId: "qv1",
        grossValue: "1000",
        discount: "100",
        netValue: "900",
        dueDate: null,
      },
      "actor1",
    );

    expect(result).toMatchObject({ id: "ar1" });
    expect(mockedAr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          quoteVersionId: "qv1",
          status: "PREVISTO",
          netValue: expect.any(Prisma.Decimal),
        }),
      }),
    );
    // Nunca PAGO, nunca qualquer outro status na criação.
    const call = mockedAr.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.status).toBe("PREVISTO");
    expect(call.data.status).not.toBe("PAGO");

    expect(mockedInstallment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ installmentNumber: 1, status: "PENDENTE" }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "accounts_receivable", action: "accounts_receivable.create" }),
      expect.anything(),
    );
  });

  it("rejeita valor líquido negativo", async () => {
    await expect(
      createAccountsReceivableInTx(
        prisma as never,
        { opportunityId: "op1", quoteVersionId: "qv1", grossValue: "100", discount: "0", netValue: "-1" },
        "actor1",
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedAr.create).not.toHaveBeenCalled();
  });
});

// --- splitInstallments -------------------------------------------------------

describe("splitInstallments", () => {
  beforeEach(resetMocks);

  it("redistribui o valor total em N parcelas iguais, sem deriva de arredondamento (resto nas primeiras)", async () => {
    mockedAr.findUnique.mockResolvedValue({
      id: "ar1",
      netValue: d(100),
      dueDate: null,
      installments: [{ id: "inst1", transactions: [] }],
    } as never);
    mockedInstallment.deleteMany.mockResolvedValue({ count: 1 } as never);
    mockedInstallment.create
      .mockResolvedValueOnce({ id: "i1", installmentNumber: 1, amount: d(33.34) } as never)
      .mockResolvedValueOnce({ id: "i2", installmentNumber: 2, amount: d(33.33) } as never)
      .mockResolvedValueOnce({ id: "i3", installmentNumber: 3, amount: d(33.33) } as never);

    const result = await splitInstallments("ar1", 3, "actor1");

    expect(result).toHaveLength(3);
    expect(mockedInstallment.deleteMany).toHaveBeenCalledWith({ where: { accountsReceivableId: "ar1" } });
    // 100 / 3 = 33.33 com resto de 1 centavo — a primeira parcela absorve o resto.
    const firstCallData = (mockedInstallment.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    const secondCallData = (mockedInstallment.create.mock.calls[1]?.[0] as { data: Record<string, unknown> }).data;
    expect((firstCallData.amount as Prisma.Decimal).toString()).toBe("33.34");
    expect((secondCallData.amount as Prisma.Decimal).toString()).toBe("33.33");
  });

  it("rejeita count <= 0 ou não inteiro", async () => {
    await expect(splitInstallments("ar1", 0, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(splitInstallments("ar1", -2, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedAr.findUnique).not.toHaveBeenCalled();
  });

  it("rejeita conta a receber inexistente", async () => {
    mockedAr.findUnique.mockResolvedValue(null);
    await expect(splitInstallments("does-not-exist", 2, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita redividir quando já existe algum pagamento registrado em qualquer parcela", async () => {
    mockedAr.findUnique.mockResolvedValue({
      id: "ar1",
      netValue: d(500),
      dueDate: null,
      installments: [{ id: "inst1", transactions: [{ id: "t1" }] }],
    } as never);

    await expect(splitInstallments("ar1", 2, "actor1")).rejects.toThrow(/já foi registrado/i);
    expect(mockedInstallment.deleteMany).not.toHaveBeenCalled();
  });
});

// --- recordPayment (FIN-2) — CASO CRÍTICO: pagamento parcial ---------------

describe("recordPayment — CASO CRÍTICO: pagamento parcial", () => {
  beforeEach(resetMocks);

  it("aceita amount menor que o saldo da parcela e acumula em amountPaid (não exige quitar de uma vez)", async () => {
    const installment = {
      id: "inst1",
      accountsReceivableId: "ar1",
      amount: d(500),
      amountPaid: d(0),
      dueDate: null,
      status: "PENDENTE",
      accountsReceivable: { installments: [] },
    };
    mockedInstallment.findUnique.mockResolvedValue({
      ...installment,
      accountsReceivable: { installments: [installment] },
    } as never);
    mockedTransaction.create.mockResolvedValue({ id: "tx1", type: "RECEBIMENTO", amount: d(200) } as never);
    mockedInstallment.update.mockResolvedValue({
      id: "inst1",
      amount: d(500),
      amountPaid: d(200),
      status: "PARCIALMENTE_PAGO",
      dueDate: null,
    } as never);
    mockedAr.update.mockResolvedValue({ id: "ar1", status: "PARCIALMENTE_PAGO" } as never);

    const result = await recordPayment(
      { installmentId: "inst1", amount: "200", paymentMethod: "PIX" },
      "actor1",
    );

    expect(result.installment).toMatchObject({ amountPaid: d(200), status: "PARCIALMENTE_PAGO" });
    expect(mockedTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "RECEBIMENTO", installmentId: "inst1" }),
      }),
    );
    expect(mockedInstallment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountPaid: d(200), status: "PARCIALMENTE_PAGO", paymentMethod: "PIX" }),
      }),
    );
    // Saldo restante da parcela continua rastreável (500 - 200 = 300) —
    // não é preciso pagar tudo de uma vez.
    expect(mockedAr.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PARCIALMENTE_PAGO" } }),
    );
  });

  it("suporta um segundo pagamento parcial completando a parcela (PAGO)", async () => {
    const installment = {
      id: "inst1",
      accountsReceivableId: "ar1",
      amount: d(500),
      amountPaid: d(200),
      dueDate: null,
      status: "PARCIALMENTE_PAGO",
    };
    mockedInstallment.findUnique.mockResolvedValue({
      ...installment,
      accountsReceivable: { installments: [installment] },
    } as never);
    mockedTransaction.create.mockResolvedValue({ id: "tx2", type: "RECEBIMENTO", amount: d(300) } as never);
    mockedInstallment.update.mockResolvedValue({
      id: "inst1",
      amount: d(500),
      amountPaid: d(500),
      status: "PAGO",
      dueDate: null,
    } as never);
    mockedAr.update.mockResolvedValue({ id: "ar1", status: "PAGO" } as never);

    const result = await recordPayment(
      { installmentId: "inst1", amount: "300", paymentMethod: "MAQUININHA" },
      "actor1",
    );

    expect(result.installment.status).toBe("PAGO");
  });

  it("rejeita pagamento maior que o saldo restante da parcela", async () => {
    const installment = { id: "inst1", accountsReceivableId: "ar1", amount: d(500), amountPaid: d(400), dueDate: null, status: "PARCIALMENTE_PAGO" };
    mockedInstallment.findUnique.mockResolvedValue({
      ...installment,
      accountsReceivable: { installments: [installment] },
    } as never);

    await expect(
      recordPayment({ installmentId: "inst1", amount: "200", paymentMethod: "PIX" }, "actor1"),
    ).rejects.toThrow(/maior do que o saldo restante/i);
    expect(mockedTransaction.create).not.toHaveBeenCalled();
  });

  it("rejeita parcela já totalmente paga", async () => {
    const installment = { id: "inst1", accountsReceivableId: "ar1", amount: d(500), amountPaid: d(500), dueDate: null, status: "PAGO" };
    mockedInstallment.findUnique.mockResolvedValue({
      ...installment,
      accountsReceivable: { installments: [installment] },
    } as never);

    await expect(
      recordPayment({ installmentId: "inst1", amount: "10", paymentMethod: "PIX" }, "actor1"),
    ).rejects.toThrow(/já está totalmente paga/i);
  });

  it("rejeita valor <= 0", async () => {
    await expect(
      recordPayment({ installmentId: "inst1", amount: "0", paymentMethod: "PIX" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      recordPayment({ installmentId: "inst1", amount: "-10", paymentMethod: "PIX" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita forma de pagamento inválida (só Pix ou maquininha)", async () => {
    await expect(
      recordPayment({ installmentId: "inst1", amount: "10", paymentMethod: "BOLETO" as never }, "actor1"),
    ).rejects.toThrow(/forma de pagamento/i);
  });

  it("rejeita parcela inexistente", async () => {
    mockedInstallment.findUnique.mockResolvedValue(null);
    await expect(
      recordPayment({ installmentId: "does-not-exist", amount: "10", paymentMethod: "PIX" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// --- reverseTransaction — CASO CRÍTICO: estorno nunca apaga a original -----

describe("reverseTransaction — CASO CRÍTICO: nunca apaga/altera a transação original", () => {
  beforeEach(resetMocks);

  it("cria uma NOVA transação ESTORNO com valor negativo, vinculada à mesma parcela — nunca deleta a original", async () => {
    const installment = {
      id: "inst1",
      accountsReceivableId: "ar1",
      amount: d(500),
      amountPaid: d(500),
      dueDate: null,
      status: "PAGO",
      paidAt: new Date("2026-07-01"),
    };
    mockedTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEBIMENTO",
      amount: d(500),
      installmentId: "inst1",
      installment: { ...installment, accountsReceivable: { installments: [installment] } },
      reversal: null,
    } as never);
    mockedTransaction.create.mockResolvedValue({ id: "tx-reversal", type: "ESTORNO", amount: d(-500) } as never);
    mockedInstallment.update.mockResolvedValue({
      id: "inst1",
      amount: d(500),
      amountPaid: d(0),
      status: "PENDENTE",
      dueDate: null,
    } as never);
    mockedAr.update.mockResolvedValue({ id: "ar1", status: "PENDENTE" } as never);

    const result = await reverseTransaction("tx1", "Pagamento em duplicidade, cliente pediu estorno.", "actor1");

    expect(result.transaction).toMatchObject({ type: "ESTORNO" });
    // Nenhuma chamada de delete/remove em FinancialTransaction — não existe
    // sequer um mock para isso, então qualquer tentativa quebraria o teste.
    expect(mockedTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "ESTORNO",
          installmentId: "inst1",
          reversesTransactionId: "tx1",
          amount: expect.any(Prisma.Decimal),
        }),
      }),
    );
    const createdData = (mockedTransaction.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect((createdData.amount as Prisma.Decimal).toString()).toBe("-500");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "financial_transaction",
        action: "financial_transaction.reverse",
        reason: "Pagamento em duplicidade, cliente pediu estorno.",
      }),
      expect.anything(),
    );
  });

  it("recalcula amountPaid da parcela (subtraindo o valor estornado) e o status agregado", async () => {
    const installment = {
      id: "inst1",
      accountsReceivableId: "ar1",
      amount: d(500),
      amountPaid: d(500),
      dueDate: null,
      status: "PAGO",
      paidAt: new Date(),
    };
    mockedTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEBIMENTO",
      amount: d(500),
      installmentId: "inst1",
      installment: { ...installment, accountsReceivable: { installments: [installment] } },
      reversal: null,
    } as never);
    mockedTransaction.create.mockResolvedValue({ id: "tx-rev", type: "ESTORNO", amount: d(-500) } as never);
    mockedInstallment.update.mockResolvedValue({
      id: "inst1",
      amount: d(500),
      amountPaid: d(0),
      status: "PENDENTE",
      dueDate: null,
    } as never);
    mockedAr.update.mockResolvedValue({ id: "ar1", status: "PENDENTE" } as never);

    await reverseTransaction("tx1", "Motivo qualquer.", "actor1");

    expect(mockedInstallment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountPaid: d(0), status: "PENDENTE" }) }),
    );
  });

  it("exige motivo obrigatório", async () => {
    await expect(reverseTransaction("tx1", "   ", "actor1")).rejects.toThrow(/motivo/i);
    expect(mockedTransaction.findUnique).not.toHaveBeenCalled();
  });

  it("rejeita estornar uma transação que já foi estornada (double-reversal)", async () => {
    mockedTransaction.findUnique.mockResolvedValue({
      id: "tx1",
      type: "RECEBIMENTO",
      amount: d(500),
      installmentId: "inst1",
      installment: { id: "inst1" },
      reversal: { id: "tx-already-reversed" },
    } as never);

    await expect(reverseTransaction("tx1", "Tentando estornar de novo.", "actor1")).rejects.toThrow(
      /já foi estornada/i,
    );
    expect(mockedTransaction.create).not.toHaveBeenCalled();
  });

  it("rejeita estornar uma transação do tipo ESTORNO (só RECEBIMENTO pode ser estornado)", async () => {
    mockedTransaction.findUnique.mockResolvedValue({
      id: "tx-estorno",
      type: "ESTORNO",
      amount: d(-500),
      installmentId: "inst1",
      installment: { id: "inst1" },
      reversal: null,
    } as never);

    await expect(reverseTransaction("tx-estorno", "Motivo.", "actor1")).rejects.toThrow(/Recebimento/i);
  });

  it("rejeita transação inexistente", async () => {
    mockedTransaction.findUnique.mockResolvedValue(null);
    await expect(reverseTransaction("does-not-exist", "Motivo.", "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});
