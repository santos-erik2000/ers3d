import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const filament = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const filamentMovement = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { filament, filamentMovement };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  createFilament,
  isLowStock,
  recordMovement,
  updateFilament,
} from "@/modules/filaments/services/filaments";

const mockedFilament = vi.mocked(prisma.filament);
const mockedMovement = vi.mocked(prisma.filamentMovement);

function resetMocks() {
  mockedFilament.create.mockReset();
  mockedFilament.update.mockReset();
  mockedFilament.updateMany.mockReset();
  mockedFilament.findMany.mockReset();
  mockedFilament.findUnique.mockReset();
  mockedFilament.findUniqueOrThrow.mockReset();
  mockedMovement.create.mockReset();
  mockedMovement.findMany.mockReset();
  vi.mocked(recordAudit).mockReset();
}

const baseFilamentInput = {
  name: "PLA Preto",
  material: "PLA",
  pricePerKg: "120.00",
  initialWeightGrams: "1000",
  minStockGrams: "100",
};

describe("createFilament", () => {
  beforeEach(resetMocks);

  it("cria o filamento com o saldo inicial informado e registra auditoria", async () => {
    mockedFilament.create.mockResolvedValue({ id: "fil1", ...baseFilamentInput } as never);

    await createFilament({ ...baseFilamentInput, availableGrams: "1000" }, "actor1");

    expect(mockedFilament.create).toHaveBeenCalledTimes(1);
    const callArg = mockedFilament.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data.availableGrams).toBeInstanceOf(Prisma.Decimal);
    expect((callArg.data.availableGrams as Prisma.Decimal).toString()).toBe("1000");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "filament", action: "filament.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("rejeita nome vazio", async () => {
    await expect(
      createFilament({ ...baseFilamentInput, name: "  ", availableGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedFilament.create).not.toHaveBeenCalled();
  });

  it("rejeita preço por kg negativo", async () => {
    await expect(
      createFilament({ ...baseFilamentInput, pricePerKg: "-1", availableGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita gramas disponíveis negativas", async () => {
    await expect(
      createFilament({ ...baseFilamentInput, availableGrams: "-10" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita estoque mínimo negativo", async () => {
    await expect(
      createFilament({ ...baseFilamentInput, minStockGrams: "-1", availableGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("updateFilament", () => {
  beforeEach(resetMocks);

  it("nunca inclui availableGrams no payload de atualização", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(500),
      pricePerKg: new Prisma.Decimal(100),
      minStockGrams: new Prisma.Decimal(50),
      name: "PLA Preto",
      status: "ACTIVE",
    } as never);
    mockedFilament.update.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto Fosco",
      pricePerKg: new Prisma.Decimal(100),
      minStockGrams: new Prisma.Decimal(50),
      status: "ACTIVE",
    } as never);

    await updateFilament("fil1", { ...baseFilamentInput, name: "PLA Preto Fosco" }, "actor1");

    const callArg = mockedFilament.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data).not.toHaveProperty("availableGrams");
    expect(callArg.data.name).toBe("PLA Preto Fosco");
  });

  it("rejeita filamento inexistente", async () => {
    mockedFilament.findUnique.mockResolvedValue(null);
    await expect(updateFilament("does-not-exist", baseFilamentInput, "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});

describe("isLowStock", () => {
  it("é true quando disponível < mínimo", () => {
    expect(
      isLowStock({ availableGrams: new Prisma.Decimal(40), minStockGrams: new Prisma.Decimal(50) }),
    ).toBe(true);
  });

  it("é false quando disponível >= mínimo", () => {
    expect(
      isLowStock({ availableGrams: new Prisma.Decimal(50), minStockGrams: new Prisma.Decimal(50) }),
    ).toBe(false);
    expect(
      isLowStock({ availableGrams: new Prisma.Decimal(60), minStockGrams: new Prisma.Decimal(50) }),
    ).toBe(false);
  });
});

// --- recordMovement — PROD-5, caso crítico da Etapa 2 §05 -------------------
// "Impedir consumo/reserva de filamento sem saldo": um filamento com 200g
// disponíveis não pode ter uma movimentação de -250g aplicada — a operação é
// bloqueada, nenhuma movimentação é criada, e o saldo permanece 200g.

describe("recordMovement", () => {
  beforeEach(resetMocks);

  it("ENTRADA soma ao saldo e grava saldo anterior/posterior corretos", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(200),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(700),
    } as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await recordMovement({ filamentId: "fil1", type: "ENTRADA", quantityGrams: "500" }, "actor1");

    expect(mockedFilament.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fil1", availableGrams: { gte: new Prisma.Decimal(0) } },
        data: { availableGrams: { increment: new Prisma.Decimal(500) }, version: { increment: 1 } },
      }),
    );
    const createArg = mockedMovement.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect((createArg.data.balanceBefore as Prisma.Decimal).toString()).toBe("200");
    expect((createArg.data.balanceAfter as Prisma.Decimal).toString()).toBe("700");
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("PERDA maior que o saldo disponível é bloqueada — nenhuma movimentação é criada e o saldo não muda", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(200),
    } as never);
    // updateMany não encontra linha que satisfaça availableGrams >= 250 -> count 0
    mockedFilament.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      recordMovement({ filamentId: "fil1", type: "PERDA", quantityGrams: "250" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    expect(mockedMovement.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a condição da escrita atômica exige saldo suficiente para o delta negativo", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(200),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(50),
    } as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await recordMovement({ filamentId: "fil1", type: "PERDA", quantityGrams: "150" }, "actor1");

    expect(mockedFilament.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fil1", availableGrams: { gte: new Prisma.Decimal(150) } },
        data: { availableGrams: { increment: new Prisma.Decimal(-150) }, version: { increment: 1 } },
      }),
    );
  });

  it("rejeita filamento inexistente", async () => {
    mockedFilament.findUnique.mockResolvedValue(null);
    await expect(
      recordMovement({ filamentId: "does-not-exist", type: "ENTRADA", quantityGrams: "10" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedFilament.updateMany).not.toHaveBeenCalled();
  });

  it("rejeita quantidade zero/negativa para ENTRADA/DEVOLUCAO/PERDA", async () => {
    await expect(
      recordMovement({ filamentId: "fil1", type: "ENTRADA", quantityGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      recordMovement({ filamentId: "fil1", type: "PERDA", quantityGrams: "-5" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      recordMovement({ filamentId: "fil1", type: "DEVOLUCAO", quantityGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedFilament.findUnique).not.toHaveBeenCalled();
  });

  it("rejeita AJUSTE/CORRECAO com delta zero", async () => {
    await expect(
      recordMovement({ filamentId: "fil1", type: "AJUSTE", quantityGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      recordMovement({ filamentId: "fil1", type: "CORRECAO", quantityGrams: "0" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("AJUSTE aceita um delta negativo (correção de saldo para baixo)", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(200),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(190),
    } as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await recordMovement({ filamentId: "fil1", type: "AJUSTE", quantityGrams: "-10" }, "actor1");

    const createArg = mockedMovement.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect((createArg.data.quantityGrams as Prisma.Decimal).toString()).toBe("-10");
    expect((createArg.data.balanceBefore as Prisma.Decimal).toString()).toBe("200");
    expect((createArg.data.balanceAfter as Prisma.Decimal).toString()).toBe("190");
  });

  it("DEVOLUCAO soma ao saldo (delta positivo)", async () => {
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(100),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(130),
    } as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await recordMovement({ filamentId: "fil1", type: "DEVOLUCAO", quantityGrams: "30" }, "actor1");

    const createArg = mockedMovement.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect((createArg.data.type as string)).toBe("DEVOLUCAO");
    expect((createArg.data.quantityGrams as Prisma.Decimal).toString()).toBe("30");
  });
});
