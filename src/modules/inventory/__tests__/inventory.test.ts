import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const inventoryItem = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const inventoryMovement = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { inventoryItem, inventoryMovement };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  adjustItem,
  createInventoryItemFromProductionInTx,
  discardItem,
  releaseReservation,
  reserveItem,
  sellItem,
} from "@/modules/inventory/services/inventory";

const mockedItem = vi.mocked(prisma.inventoryItem);
const mockedMovement = vi.mocked(prisma.inventoryMovement);

function resetMocks() {
  mockedItem.create.mockReset();
  mockedItem.update.mockReset();
  mockedItem.updateMany.mockReset();
  mockedItem.findMany.mockReset();
  mockedItem.findUnique.mockReset();
  mockedItem.findUniqueOrThrow.mockReset();
  mockedMovement.create.mockReset();
  mockedMovement.findMany.mockReset();
  vi.mocked(recordAudit).mockReset();
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    quantityProduced: 10,
    quantityAvailable: 10,
    quantityReserved: 0,
    quantitySold: 0,
    quantityDiscarded: 0,
    ...overrides,
  };
}

// --- createInventoryItemFromProductionInTx (INV-1) --------------------------

describe("createInventoryItemFromProductionInTx", () => {
  beforeEach(resetMocks);

  it("cria o item com quantityAvailable = quantityProduced e grava o PRODUCAO inicial (0 -> N)", async () => {
    mockedItem.create.mockResolvedValue({ id: "inv1", quantityProduced: 5, quantityAvailable: 5 } as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    const result = await createInventoryItemFromProductionInTx(
      prisma as never,
      {
        opportunityId: "op1",
        jobId: "job1",
        qualityCheckId: "qc1",
        quantityProduced: 5,
        unitCost: new Prisma.Decimal("12.50"),
      },
      "actor1",
    );

    expect(result).toMatchObject({ id: "inv1" });
    expect(mockedItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          jobId: "job1",
          qualityCheckId: "qc1",
          quantityProduced: 5,
          quantityAvailable: 5,
          quantityReserved: 0,
          quantitySold: 0,
          quantityDiscarded: 0,
          status: "ACTIVE",
        }),
      }),
    );
    expect(mockedMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inventoryItemId: "inv1",
          type: "PRODUCAO",
          quantity: 5,
          availableBefore: 0,
          availableAfter: 5,
        }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "inventory_item", action: "inventory_item.create" }),
      expect.anything(),
    );
  });

  it("rejeita quantidade produzida <= 0", async () => {
    await expect(
      createInventoryItemFromProductionInTx(
        prisma as never,
        { opportunityId: "op1", jobId: null, qualityCheckId: "qc1", quantityProduced: 0, unitCost: null },
        "actor1",
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedItem.create).not.toHaveBeenCalled();
  });
});

// --- venda/descarte sem estoque (INV-2, caso crítico) -----------------------

describe("sellItem — INV-2 caso crítico: venda sem estoque suficiente", () => {
  beforeEach(resetMocks);

  it("bloqueia a venda quando quantityAvailable é zero", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 0 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(sellItem("inv1", 1, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(sellItem("inv1", 1, "actor1")).rejects.toThrow(/estoque insuficiente/i);

    expect(mockedMovement.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("bloqueia a venda quando a quantidade pedida excede o disponível", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 3 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(sellItem("inv1", 5, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1", quantityAvailable: { gte: 5 } } }),
    );
  });

  it("vende com sucesso quando há saldo suficiente — debita disponível, credita vendido", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 10 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(
      baseItem({ quantityAvailable: 6, quantitySold: 4 }) as never,
    );
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await sellItem("inv1", 4, "actor1", "Venda balcão");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv1", quantityAvailable: { gte: 4 } },
        data: expect.objectContaining({
          quantityAvailable: { increment: -4 },
          quantitySold: { increment: 4 },
        }),
      }),
    );
    expect(mockedMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "VENDA",
          quantity: 4,
          availableBefore: 10,
          availableAfter: 6,
          soldBefore: 0,
          soldAfter: 4,
        }),
      }),
    );
  });

  it("suporta venda parcial com quantidade > 1 sem travar em unidade única", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 10 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(
      baseItem({ quantityAvailable: 3, quantitySold: 7 }) as never,
    );
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await sellItem("inv1", 7, "actor1");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1", quantityAvailable: { gte: 7 } } }),
    );
  });
});

describe("discardItem — INV-2 caso crítico: descarte sem estoque suficiente", () => {
  beforeEach(resetMocks);

  it("bloqueia o descarte quando quantityAvailable é zero", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 0 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(discardItem("inv1", 1, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedMovement.create).not.toHaveBeenCalled();
  });

  it("descarta com sucesso quando há saldo — debita disponível, credita descartado (quantidade > 1)", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 10 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(
      baseItem({ quantityAvailable: 7, quantityDiscarded: 3 }) as never,
    );
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await discardItem("inv1", 3, "actor1", "Peça quebrada no transporte interno");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantityAvailable: { increment: -3 },
          quantityDiscarded: { increment: 3 },
        }),
      }),
    );
  });
});

// --- reserva / liberação de reserva ------------------------------------------

describe("reserveItem / releaseReservation", () => {
  beforeEach(resetMocks);

  it("reserva debita disponível e credita reservado", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 10 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(
      baseItem({ quantityAvailable: 8, quantityReserved: 2 }) as never,
    );
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await reserveItem("inv1", 2, "actor1");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv1", quantityAvailable: { gte: 2 } },
        data: expect.objectContaining({ quantityAvailable: { increment: -2 }, quantityReserved: { increment: 2 } }),
      }),
    );
  });

  it("bloqueia reserva maior que o disponível", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 1 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(reserveItem("inv1", 5, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("libera reserva credita disponível e debita reservado", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 8, quantityReserved: 2 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(
      baseItem({ quantityAvailable: 10, quantityReserved: 0 }) as never,
    );
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await releaseReservation("inv1", 2, "actor1");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1", quantityReserved: { gte: 2 } } }),
    );
  });

  it("bloqueia liberar mais do que está reservado, com mensagem específica", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityReserved: 1 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(releaseReservation("inv1", 3, "actor1")).rejects.toThrow(/reserva insuficiente/i);
  });
});

// --- ajuste manual ------------------------------------------------------------

describe("adjustItem", () => {
  beforeEach(resetMocks);

  it("exige justificativa", async () => {
    await expect(adjustItem("inv1", 2, "actor1", "")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedItem.updateMany).not.toHaveBeenCalled();
  });

  it("rejeita delta zero", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem() as never);
    await expect(adjustItem("inv1", 0, "actor1", "Contagem física")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("ajuste negativo exige saldo suficiente", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 2 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(adjustItem("inv1", -5, "actor1", "Contagem física divergente")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1", quantityAvailable: { gte: 5 } } }),
    );
  });

  it("ajuste positivo aplica sem exigir saldo mínimo", async () => {
    mockedItem.findUnique.mockResolvedValue(baseItem({ quantityAvailable: 2 }) as never);
    mockedItem.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedItem.findUniqueOrThrow.mockResolvedValue(baseItem({ quantityAvailable: 5 }) as never);
    mockedMovement.create.mockResolvedValue({ id: "mov1" } as never);

    await adjustItem("inv1", 3, "actor1", "Contagem física encontrou mais peças");

    expect(mockedItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1", quantityAvailable: { gte: 0 } } }),
    );
  });
});

describe("rejeita item de estoque inexistente", () => {
  beforeEach(resetMocks);

  it("sellItem", async () => {
    mockedItem.findUnique.mockResolvedValue(null);
    await expect(sellItem("does-not-exist", 1, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedItem.updateMany).not.toHaveBeenCalled();
  });
});
