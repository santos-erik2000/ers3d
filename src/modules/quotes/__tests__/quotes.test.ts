import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const opportunity = { findUnique: vi.fn() };
  const job = { findUnique: vi.fn() };
  const quote = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const quoteVersion = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const prismaMock: Record<string, unknown> = { opportunity, job, quote, quoteVersion };
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

function resetMocks() {
  mockedOpportunity.findUnique.mockReset();
  mockedJob.findUnique.mockReset();
  mockedQuote.findFirst.mockReset();
  mockedQuote.create.mockReset();
  mockedQuote.update.mockReset();
  mockedQuoteVersion.findFirst.mockReset();
  mockedQuoteVersion.findUnique.mockReset();
  mockedQuoteVersion.create.mockReset();
  mockedQuoteVersion.update.mockReset();
  vi.mocked(recordAudit).mockReset();
}

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
    mockedQuoteVersion.findUnique.mockResolvedValue({ id: "qv1", quoteId: "quote1", status: "SENT" } as never);
    mockedQuoteVersion.update.mockResolvedValue({ id: "qv1", status: "APPROVED" } as never);

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
