import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const opportunity = { findUnique: vi.fn() };
  const job = { findUnique: vi.fn() };
  const quote = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const quoteVersion = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  // Usados só pelo caminho de reserva/produção de `approveVersion` (Sprint 6)
  // quando a versão aprovada tem `jobId` — `recordMovementInTx` (módulo
  // filaments) chama estes diretamente no mesmo `tx` mockado.
  const filament = { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() };
  const filamentMovement = { create: vi.fn() };
  const productionOrder = { create: vi.fn() };
  // Usados só pelo caminho do nascimento da conta a receber (Sprint 9) dentro
  // de `approveVersion` — `createAccountsReceivableInTx` chama estes no mesmo
  // `tx` mockado.
  const accountsReceivable = { create: vi.fn() };
  const paymentInstallment = { create: vi.fn() };
  const prismaMock: Record<string, unknown> = {
    opportunity,
    job,
    quote,
    quoteVersion,
    filament,
    filamentMovement,
    productionOrder,
    accountsReceivable,
    paymentInstallment,
  };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  approveVersion,
  createManualVersion,
  createVersionFromJob,
  hasApprovedQuoteVersion,
  rejectVersion,
  sendVersion,
} from "@/modules/quotes/services/quotes";

const mockedOpportunity = vi.mocked(prisma.opportunity);
const mockedJob = vi.mocked(prisma.job);
const mockedQuote = vi.mocked(prisma.quote);
const mockedQuoteVersion = vi.mocked(prisma.quoteVersion);
const mockedFilament = vi.mocked(prisma.filament);
const mockedFilamentMovement = vi.mocked(prisma.filamentMovement);
const mockedProductionOrder = vi.mocked(prisma.productionOrder);
const mockedAccountsReceivable = vi.mocked(prisma.accountsReceivable);
const mockedPaymentInstallment = vi.mocked(prisma.paymentInstallment);

function resetMocks() {
  mockedOpportunity.findUnique.mockReset();
  mockedJob.findUnique.mockReset();
  mockedQuote.findFirst.mockReset();
  mockedQuote.findUnique.mockReset();
  mockedQuote.create.mockReset();
  mockedQuote.update.mockReset();
  mockedQuoteVersion.findFirst.mockReset();
  mockedQuoteVersion.findUnique.mockReset();
  mockedQuoteVersion.create.mockReset();
  mockedQuoteVersion.update.mockReset();
  mockedFilament.findUnique.mockReset();
  mockedFilament.updateMany.mockReset();
  mockedFilament.findUniqueOrThrow.mockReset();
  mockedFilamentMovement.create.mockReset();
  mockedProductionOrder.create.mockReset();
  mockedAccountsReceivable.create.mockReset();
  mockedPaymentInstallment.create.mockReset();
  vi.mocked(recordAudit).mockReset();
}

// Toda `QuoteVersion` aprovada precisa destes campos monetários para o
// nascimento da conta a receber (Sprint 9) dentro de `approveVersion` — os
// testes de approveVersion abaixo espalham este objeto por cima do mock
// específico de cada caso, para não repetir os quatro campos em todo `it`.
const approvableVersionMoneyFields = {
  originalValue: new Prisma.Decimal(500),
  discount: new Prisma.Decimal(0),
  finalValue: new Prisma.Decimal(500),
  deliveryDeadline: null,
};

// --- createVersionFromJob ------------------------------------------------------

describe("createVersionFromJob", () => {
  beforeEach(resetMocks);

  it("rejeita oportunidade inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue(null);

    await expect(
      createVersionFromJob({ opportunityId: "op1", jobId: "job1" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedQuoteVersion.create).not.toHaveBeenCalled();
  });

  it("rejeita job inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedJob.findUnique.mockResolvedValue(null);

    await expect(
      createVersionFromJob({ opportunityId: "op1", jobId: "job1" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedQuoteVersion.create).not.toHaveBeenCalled();
  });

  it("rejeita desconto negativo", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job1",
      finalPrice: new Prisma.Decimal(100),
      quantityProduced: 1,
    } as never);

    await expect(
      createVersionFromJob({ opportunityId: "op1", jobId: "job1", discount: "-10" }, "actor1"),
    ).rejects.toThrow(/desconto/i);
    expect(mockedQuoteVersion.create).not.toHaveBeenCalled();
  });

  it("rejeita desconto maior do que o valor original", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job1",
      finalPrice: new Prisma.Decimal(100),
      quantityProduced: 1,
    } as never);

    await expect(
      createVersionFromJob({ opportunityId: "op1", jobId: "job1", discount: "150" }, "actor1"),
    ).rejects.toThrow(/desconto/i);
    expect(mockedQuoteVersion.create).not.toHaveBeenCalled();
  });

  it("cria a primeira versão (número 1) reaproveitando o preço do job, criando o Quote se não existir", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job1",
      finalPrice: new Prisma.Decimal(200),
      quantityProduced: 3,
    } as never);
    mockedQuote.findFirst.mockResolvedValue(null);
    mockedQuote.create.mockResolvedValue({ id: "quote1", opportunityId: "op1", status: "DRAFT" } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue(null);
    mockedQuoteVersion.create.mockResolvedValue({ id: "qv1", versionNumber: 1 } as never);

    await createVersionFromJob({ opportunityId: "op1", jobId: "job1", discount: "20" }, "actor1");

    expect(mockedQuote.create).toHaveBeenCalledWith({ data: { opportunityId: "op1", status: "DRAFT" } });
    const callArg = mockedQuoteVersion.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data.versionNumber).toBe(1);
    expect(callArg.data.quoteId).toBe("quote1");
    expect(callArg.data.jobId).toBe("job1");
    expect(callArg.data.isManual).toBe(false);
    expect((callArg.data.originalValue as Prisma.Decimal).toString()).toBe("200");
    expect((callArg.data.discount as Prisma.Decimal).toString()).toBe("20");
    expect((callArg.data.finalValue as Prisma.Decimal).toString()).toBe("180");
    expect(callArg.data.status).toBe("DRAFT");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "quote_version", action: "quote_version.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("incrementa o número da versão quando o quote já tem versões anteriores", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job1",
      finalPrice: new Prisma.Decimal(200),
      quantityProduced: 1,
    } as never);
    mockedQuote.findFirst.mockResolvedValue({ id: "quote1", opportunityId: "op1", status: "APPROVED" } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue({ versionNumber: 3 } as never);
    mockedQuoteVersion.create.mockResolvedValue({ id: "qv4", versionNumber: 4 } as never);

    await createVersionFromJob({ opportunityId: "op1", jobId: "job1" }, "actor1");

    expect(mockedQuote.create).not.toHaveBeenCalled();
    const callArg = mockedQuoteVersion.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data.versionNumber).toBe(4);
  });
});

// --- createManualVersion --------------------------------------------------------

describe("createManualVersion", () => {
  beforeEach(resetMocks);

  it("rejeita sem justificativa", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);

    await expect(
      createManualVersion(
        { opportunityId: "op1", originalValue: "100", manualJustification: "   " },
        "actor1",
      ),
    ).rejects.toThrow(/justificativa/i);
    expect(mockedQuoteVersion.create).not.toHaveBeenCalled();
  });

  it("rejeita valor original <= 0", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);

    await expect(
      createManualVersion(
        { opportunityId: "op1", originalValue: "0", manualJustification: "Cliente pediu preço fechado." },
        "actor1",
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("cria a versão manual com isManual=true e a justificativa persistida", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedQuote.findFirst.mockResolvedValue({ id: "quote1", opportunityId: "op1" } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue(null);
    mockedQuoteVersion.create.mockResolvedValue({ id: "qv1", versionNumber: 1 } as never);

    await createManualVersion(
      {
        opportunityId: "op1",
        originalValue: "500",
        discount: "50",
        manualJustification: "Peça urgente, negociado por telefone.",
      },
      "actor1",
    );

    const callArg = mockedQuoteVersion.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data.isManual).toBe(true);
    expect(callArg.data.jobId).toBeNull();
    expect(callArg.data.manualJustification).toBe("Peça urgente, negociado por telefone.");
    expect((callArg.data.finalValue as Prisma.Decimal).toString()).toBe("450");
  });
});

// --- CASO CRÍTICO: nunca editar uma versão aprovada -----------------------------

describe("caso crítico — nunca editar orçamento já aprovado (cria nova versão)", () => {
  beforeEach(resetMocks);

  it("ao 'editar' um orçamento com versão aprovada, cria uma NOVA versão e nunca chama update na versão aprovada", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    // Quote já existe com uma versão aprovada (versão 1).
    mockedQuote.findFirst.mockResolvedValue({ id: "quote1", opportunityId: "op1", status: "APPROVED" } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue({ versionNumber: 1 } as never);
    mockedQuoteVersion.create.mockResolvedValue({ id: "qv2", versionNumber: 2 } as never);

    await createManualVersion(
      {
        opportunityId: "op1",
        originalValue: "999",
        manualJustification: "Cliente pediu para reduzir a quantidade depois de já ter aprovado a v1.",
      },
      "actor1",
    );

    // Uma nova linha nasce — versão 2, nunca sobrescrevendo a versão 1 aprovada.
    expect(mockedQuoteVersion.create).toHaveBeenCalledTimes(1);
    const callArg = mockedQuoteVersion.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data.versionNumber).toBe(2);

    // Nenhuma chamada de update em QuoteVersion aconteceu — a v1 aprovada
    // permanece intacta e consultável, exatamente como o caso crítico exige.
    expect(mockedQuoteVersion.update).not.toHaveBeenCalled();
  });

  it("approveVersion rejeita reaprovar uma versão que já está aprovada (a decisão anterior não é regravável)", async () => {
    mockedQuoteVersion.findFirst.mockReset();
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "APPROVED" } as never);

    await expect(approveVersion("qv1", "actor1")).rejects.toThrow(/já está aprovada/i);
    expect(mockedQuoteVersion.update).not.toHaveBeenCalled();
  });
});

// --- approveVersion / rejectVersion / sendVersion -------------------------------

describe("approveVersion", () => {
  beforeEach(resetMocks);

  it("rejeita versão inexistente", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue(null as never);

    await expect(approveVersion("does-not-exist", "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita aprovar uma versão já rejeitada", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "REJECTED" } as never);

    await expect(approveVersion("qv1", "actor1")).rejects.toThrow(/rejeitada/i);
  });

  it("aprova uma versão DRAFT/SENT, grava acceptedAt e reflete o status no Quote", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({
      id: "qv1",
      quoteId: "quote1",
      status: "SENT",
      jobId: null,
      ...approvableVersionMoneyFields,
    } as never);
    mockedQuote.findUnique.mockResolvedValue({ id: "quote1", opportunityId: "op1" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv1", status: "APPROVED" } as never);
    mockedAccountsReceivable.create.mockResolvedValue({ id: "ar1", status: "PREVISTO" } as never);
    mockedPaymentInstallment.create.mockResolvedValue({ id: "inst1" } as never);

    const result = await approveVersion("qv1", "actor1");

    expect(result).toMatchObject({ id: "qv1", status: "APPROVED" });
    expect(mockedQuoteVersion.update).toHaveBeenCalledWith({
      where: { id: "qv1" },
      data: expect.objectContaining({ status: "APPROVED" }),
    });
    expect(mockedQuote.update).toHaveBeenCalledWith({
      where: { id: "quote1" },
      data: { status: "APPROVED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "quote_version", action: "quote_version.approve", userId: "actor1" }),
      expect.anything(),
    );
  });
});

// --- approveVersion + reserva de filamento / ordem de produção (Sprint 6, PROD-1) --
// Caso crítico da Etapa 2 §05: "Impedir consumo/reserva de filamento sem
// saldo" combinado com "Alterar orçamento já aprovado" — se qualquer
// filamento do job não tiver saldo, a aprovação inteira falha: a versão não
// fica aprovada, nenhum filamento é reservado, nenhuma ordem é criada.

describe("approveVersion — reserva de filamento e ordem de produção quando a versão tem job (Sprint 6)", () => {
  beforeEach(resetMocks);

  it("reserva cada filamento do job e cria a ProductionOrder quando há saldo suficiente para todos", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({
      id: "qv1",
      quoteId: "quote1",
      status: "SENT",
      jobId: "job1",
      deliveryDeadline: new Date("2026-08-01"),
      originalValue: new Prisma.Decimal(500),
      discount: new Prisma.Decimal(0),
      finalValue: new Prisma.Decimal(500),
    } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job1",
      jobFilaments: [
        { filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) },
        { filamentId: "fil2", gramsUsed: new Prisma.Decimal(50) },
      ],
    } as never);
    mockedQuote.findUnique.mockResolvedValue({ id: "quote1", opportunityId: "op1" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv1", status: "APPROVED" } as never);

    // recordMovementInTx (dentro de approveVersion) lê o filamento, tenta o
    // updateMany condicional (sucesso = saldo suficiente) e relê o saldo.
    mockedFilament.findUnique
      .mockResolvedValueOnce({ id: "fil1", name: "PLA Preto", availableGrams: new Prisma.Decimal(500) } as never)
      .mockResolvedValueOnce({ id: "fil2", name: "PETG Branco", availableGrams: new Prisma.Decimal(200) } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow
      .mockResolvedValueOnce({ id: "fil1", availableGrams: new Prisma.Decimal(400) } as never)
      .mockResolvedValueOnce({ id: "fil2", availableGrams: new Prisma.Decimal(150) } as never);
    mockedFilamentMovement.create.mockResolvedValue({ id: "mov1" } as never);
    mockedProductionOrder.create.mockResolvedValue({ id: "po1" } as never);
    // Sprint 9 (FIN-1): a MESMA aprovação também gera a conta a receber —
    // SEMPRE status PREVISTO (caso crítico "nunca receita já realizada").
    mockedAccountsReceivable.create.mockResolvedValue({ id: "ar1", status: "PREVISTO" } as never);
    mockedPaymentInstallment.create.mockResolvedValue({ id: "inst1" } as never);

    const result = await approveVersion("qv1", "actor1");

    expect(result).toMatchObject({ id: "qv1", status: "APPROVED" });

    // Duas reservas (uma por filamento do job), ambas tipo RESERVA, com o
    // delta assinado negativo (débito) correspondente às gramas do job.
    expect(mockedFilament.updateMany).toHaveBeenCalledTimes(2);
    expect(mockedFilament.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "fil1", availableGrams: { gte: new Prisma.Decimal(100) } },
        data: expect.objectContaining({ availableGrams: { increment: new Prisma.Decimal(-100) } }),
      }),
    );
    expect(mockedFilament.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "fil2", availableGrams: { gte: new Prisma.Decimal(50) } },
        data: expect.objectContaining({ availableGrams: { increment: new Prisma.Decimal(-50) } }),
      }),
    );
    expect(mockedFilamentMovement.create).toHaveBeenCalledTimes(2);
    for (const call of mockedFilamentMovement.create.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.type).toBe("RESERVA");
    }

    // Ordem de produção criada com status AGUARDANDO, vinculada ao job/oportunidade.
    expect(mockedProductionOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          jobId: "job1",
          printStatus: "AGUARDANDO",
        }),
      }),
    );

    // CASO CRÍTICO (FIN-1): a conta a receber nasce SEMPRE em PREVISTO —
    // nunca PAGO, nunca receita já realizada — com valor = finalValue da
    // versão aprovada, e a primeira parcela cobre o valor total.
    expect(mockedAccountsReceivable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          quoteVersionId: "qv1",
          status: "PREVISTO",
          netValue: new Prisma.Decimal(500),
        }),
      }),
    );
    expect(mockedPaymentInstallment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          installmentNumber: 1,
          amount: new Prisma.Decimal(500),
          status: "PENDENTE",
        }),
      }),
    );
  });

  it("caso crítico: se QUALQUER filamento do job não tiver saldo, a versão NÃO fica aprovada e NENHUMA ordem é criada", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({
      id: "qv2",
      quoteId: "quote2",
      status: "SENT",
      jobId: "job2",
      deliveryDeadline: null,
    } as never);
    mockedJob.findUnique.mockResolvedValue({
      id: "job2",
      jobFilaments: [
        { filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) },
        // fil2 não tem saldo suficiente — a reserva deste falha.
        { filamentId: "fil2", gramsUsed: new Prisma.Decimal(250) },
      ],
    } as never);
    mockedQuote.findUnique.mockResolvedValue({ id: "quote2", opportunityId: "op2" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv2", status: "APPROVED" } as never);

    // Primeira reserva (fil1) passa; segunda (fil2) falha por saldo insuficiente.
    mockedFilament.findUnique
      .mockResolvedValueOnce({ id: "fil1", name: "PLA Preto", availableGrams: new Prisma.Decimal(500) } as never)
      .mockResolvedValueOnce({ id: "fil2", name: "PETG Branco", availableGrams: new Prisma.Decimal(200) } as never);
    mockedFilament.updateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValueOnce({
      id: "fil1",
      availableGrams: new Prisma.Decimal(400),
    } as never);
    mockedFilamentMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await expect(approveVersion("qv2", "actor1")).rejects.toThrow(/saldo insuficiente/i);

    // Nenhuma ordem de produção é criada quando a aprovação falha — nada
    // fica em estado parcial (mesma transação da versão + reservas).
    expect(mockedProductionOrder.create).not.toHaveBeenCalled();
  });

  it("versão manual (sem jobId) aprova normalmente sem reservar filamento nem criar ordem de produção — MAS ainda gera a conta a receber (Sprint 9, sempre com ou sem job)", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({
      id: "qv3",
      quoteId: "quote3",
      status: "SENT",
      jobId: null,
      ...approvableVersionMoneyFields,
    } as never);
    mockedQuote.findUnique.mockResolvedValue({ id: "quote3", opportunityId: "op3" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv3", status: "APPROVED" } as never);
    mockedAccountsReceivable.create.mockResolvedValue({ id: "ar3", status: "PREVISTO" } as never);
    mockedPaymentInstallment.create.mockResolvedValue({ id: "inst3" } as never);

    const result = await approveVersion("qv3", "actor1");

    expect(result).toMatchObject({ id: "qv3", status: "APPROVED" });
    expect(mockedJob.findUnique).not.toHaveBeenCalled();
    expect(mockedFilament.updateMany).not.toHaveBeenCalled();
    expect(mockedProductionOrder.create).not.toHaveBeenCalled();
    // Diferente da reserva de estoque/ordem de produção (que exige job), a
    // conta a receber nasce SEMPRE que a versão é aprovada.
    expect(mockedAccountsReceivable.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ opportunityId: "op3", status: "PREVISTO" }) }),
    );
  });
});

describe("rejectVersion", () => {
  beforeEach(resetMocks);

  it("exige motivo", async () => {
    await expect(rejectVersion("qv1", "   ", "actor1")).rejects.toThrow(/motivo/i);
  });

  it("rejeita quando a versão já está aprovada", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "APPROVED" } as never);

    await expect(rejectVersion("qv1", "Cliente desistiu.", "actor1")).rejects.toThrow(/aprovada/i);
  });

  it("rejeita a versão e grava o motivo como lostReason no Quote", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "SENT" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv1", status: "REJECTED" } as never);

    await rejectVersion("qv1", "Cliente achou caro.", "actor1");

    expect(mockedQuote.update).toHaveBeenCalledWith({
      where: { id: "quote1" },
      data: { status: "REJECTED", lostReason: "Cliente achou caro." },
    });
  });
});

describe("sendVersion", () => {
  beforeEach(resetMocks);

  it("só permite enviar uma versão em rascunho", async () => {
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "SENT" } as never);

    await expect(sendVersion("qv1", "actor1")).rejects.toThrow(/rascunho/i);
  });
});

// --- hasApprovedQuoteVersion -----------------------------------------------------

describe("hasApprovedQuoteVersion", () => {
  beforeEach(resetMocks);

  it("retorna true quando existe uma versão aprovada vinculada à oportunidade", async () => {
    mockedQuoteVersion.findFirst.mockResolvedValue({ id: "qv1" } as never);

    await expect(hasApprovedQuoteVersion("op1")).resolves.toBe(true);
    expect(mockedQuoteVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "APPROVED", quote: { opportunityId: "op1" } } }),
    );
  });

  it("retorna false quando não existe nenhuma", async () => {
    mockedQuoteVersion.findFirst.mockResolvedValue(null);
    await expect(hasApprovedQuoteVersion("op1")).resolves.toBe(false);
  });
});
