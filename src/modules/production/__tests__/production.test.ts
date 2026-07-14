import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const productionOrder = { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const opportunity = { findUnique: vi.fn() };
  const jobFilament = { update: vi.fn() };
  const printer = { findMany: vi.fn() };
  // Usados só pelo caminho de reconciliação de estoque de `completeProduction`
  // — `recordMovementInTx` (módulo filaments) chama estes diretamente no
  // mesmo `tx` mockado.
  const filament = { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() };
  const filamentMovement = { create: vi.fn() };
  const prismaMock: Record<string, unknown> = {
    productionOrder,
    opportunity,
    jobFilament,
    printer,
    filament,
    filamentMovement,
  };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/modules/quotes/services/quotes", () => ({ hasApprovedQuoteVersion: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { hasApprovedQuoteVersion } from "@/modules/quotes/services/quotes";
import {
  BusinessRuleError,
  completeProduction,
  createManualProductionOrder,
  hasCompletedProductionOrder,
  updateProductionOrderDetails,
} from "@/modules/production/services/production";

const mockedOrder = vi.mocked(prisma.productionOrder);
const mockedOpportunity = vi.mocked(prisma.opportunity);
const mockedJobFilament = vi.mocked(prisma.jobFilament);
const mockedFilament = vi.mocked(prisma.filament);
const mockedFilamentMovement = vi.mocked(prisma.filamentMovement);
const mockedHasApprovedQuoteVersion = vi.mocked(hasApprovedQuoteVersion);

function resetMocks() {
  mockedOrder.findUnique.mockReset();
  mockedOrder.findFirst.mockReset();
  mockedOrder.create.mockReset();
  mockedOrder.update.mockReset();
  mockedOpportunity.findUnique.mockReset();
  mockedJobFilament.update.mockReset();
  mockedFilament.findUnique.mockReset();
  mockedFilament.updateMany.mockReset();
  mockedFilament.findUniqueOrThrow.mockReset();
  mockedFilamentMovement.create.mockReset();
  mockedHasApprovedQuoteVersion.mockReset();
  vi.mocked(recordAudit).mockReset();
}

// --- completeProduction — PROD-3, caso crítico "Editar job já com estoque
// reservado" (Etapa 2 §05), aplicado no momento da conclusão da produção
// (o Job em si é imutável neste sistema — a reconciliação acontece aqui). ---

describe("completeProduction", () => {
  beforeEach(resetMocks);

  it("rejeita ordem inexistente", async () => {
    mockedOrder.findUnique.mockResolvedValue(null);
    await expect(
      completeProduction("missing", { actualHours: "2", filamentActuals: [] }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita concluir uma ordem já concluída", async () => {
    mockedOrder.findUnique.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA", jobId: null } as never);
    await expect(
      completeProduction("po1", { actualHours: "2", filamentActuals: [] }, "actor1"),
    ).rejects.toThrow(/já foi concluída/i);
  });

  it("rejeita horas reais <= 0", async () => {
    mockedOrder.findUnique.mockResolvedValue({ id: "po1", printStatus: "AGUARDANDO", jobId: null } as never);
    await expect(
      completeProduction("po1", { actualHours: "0", filamentActuals: [] }, "actor1"),
    ).rejects.toThrow(/horas reais/i);
  });

  it("gramas reais MAIORES que o reservado: consome a diferença (RESERVA adicional) após validar saldo", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: "job1",
      technicalNotes: null,
      job: {
        jobFilaments: [{ id: "jf1", filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) }],
      },
    } as never);

    // gramsUsed=100, actualGrams=130 -> diff=+30 -> RESERVA de 30g adicional.
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(50),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(20),
    } as never);
    mockedFilamentMovement.create.mockResolvedValue({ id: "mov1" } as never);
    mockedJobFilament.update.mockResolvedValue({ id: "jf1" } as never);
    mockedOrder.update.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA" } as never);

    const result = await completeProduction(
      "po1",
      { actualHours: "5", filamentActuals: [{ filamentId: "fil1", actualGrams: "130" }] },
      "actor1",
    );

    expect(result).toMatchObject({ id: "po1", printStatus: "CONCLUIDA" });
    expect(mockedFilament.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fil1", availableGrams: { gte: new Prisma.Decimal(30) } },
        data: expect.objectContaining({ availableGrams: { increment: new Prisma.Decimal(-30) } }),
      }),
    );
    const movementData = (mockedFilamentMovement.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(movementData.type).toBe("RESERVA");
    expect(mockedJobFilament.update).toHaveBeenCalledWith({
      where: { id: "jf1" },
      data: { gramsActual: new Prisma.Decimal(130) },
    });
    expect(mockedOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "po1" },
        data: expect.objectContaining({ printStatus: "CONCLUIDA" }),
      }),
    );
  });

  it("gramas reais MAIORES que o reservado, sem saldo para a diferença: falha e NADA é aplicado (ordem continua não concluída)", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: "job1",
      technicalNotes: null,
      job: {
        jobFilaments: [{ id: "jf1", filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) }],
      },
    } as never);

    // diff = +30, mas updateMany não encontra saldo suficiente -> count 0.
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(10),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      completeProduction(
        "po1",
        { actualHours: "5", filamentActuals: [{ filamentId: "fil1", actualGrams: "130" }] },
        "actor1",
      ),
    ).rejects.toThrow(/saldo insuficiente/i);

    expect(mockedJobFilament.update).not.toHaveBeenCalled();
    expect(mockedOrder.update).not.toHaveBeenCalled();
  });

  it("gramas reais MENORES que o reservado: libera a diferença de volta (LIBERACAO_RESERVA)", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: "job1",
      technicalNotes: null,
      job: {
        jobFilaments: [{ id: "jf1", filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) }],
      },
    } as never);

    // gramsUsed=100, actualGrams=70 -> diff=-30 -> LIBERACAO_RESERVA de 30g.
    mockedFilament.findUnique.mockResolvedValue({
      id: "fil1",
      name: "PLA Preto",
      availableGrams: new Prisma.Decimal(0),
    } as never);
    mockedFilament.updateMany.mockResolvedValue({ count: 1 } as never);
    mockedFilament.findUniqueOrThrow.mockResolvedValue({
      id: "fil1",
      availableGrams: new Prisma.Decimal(30),
    } as never);
    mockedFilamentMovement.create.mockResolvedValue({ id: "mov1" } as never);
    mockedJobFilament.update.mockResolvedValue({ id: "jf1" } as never);
    mockedOrder.update.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA" } as never);

    await completeProduction(
      "po1",
      { actualHours: "4", filamentActuals: [{ filamentId: "fil1", actualGrams: "70" }] },
      "actor1",
    );

    expect(mockedFilament.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fil1", availableGrams: { gte: new Prisma.Decimal(0) } },
        data: expect.objectContaining({ availableGrams: { increment: new Prisma.Decimal(30) } }),
      }),
    );
    const movementData = (mockedFilamentMovement.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(movementData.type).toBe("LIBERACAO_RESERVA");
  });

  it("gramas reais IGUAIS ao reservado: nenhuma movimentação de estoque é criada", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: "job1",
      technicalNotes: null,
      job: {
        jobFilaments: [{ id: "jf1", filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) }],
      },
    } as never);
    mockedJobFilament.update.mockResolvedValue({ id: "jf1" } as never);
    mockedOrder.update.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA" } as never);

    await completeProduction(
      "po1",
      { actualHours: "3", filamentActuals: [{ filamentId: "fil1", actualGrams: "100" }] },
      "actor1",
    );

    expect(mockedFilament.updateMany).not.toHaveBeenCalled();
    expect(mockedFilamentMovement.create).not.toHaveBeenCalled();
    expect(mockedJobFilament.update).toHaveBeenCalledWith({
      where: { id: "jf1" },
      data: { gramsActual: new Prisma.Decimal(100) },
    });
  });

  it("rejeita quando faltam gramas reais de algum filamento do job", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: "job1",
      job: {
        jobFilaments: [
          { id: "jf1", filamentId: "fil1", gramsUsed: new Prisma.Decimal(100) },
          { id: "jf2", filamentId: "fil2", gramsUsed: new Prisma.Decimal(50) },
        ],
      },
    } as never);

    await expect(
      completeProduction(
        "po1",
        { actualHours: "3", filamentActuals: [{ filamentId: "fil1", actualGrams: "100" }] },
        "actor1",
      ),
    ).rejects.toThrow(/gramas reais de todos os filamentos/i);
  });

  it("ordem sem job vinculado: ignora reconciliação de estoque e conclui só com horas reais", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: null,
      technicalNotes: null,
      job: null,
    } as never);
    mockedOrder.update.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA" } as never);

    await completeProduction("po1", { actualHours: "3", filamentActuals: [] }, "actor1");

    expect(mockedFilament.updateMany).not.toHaveBeenCalled();
    expect(mockedJobFilament.update).not.toHaveBeenCalled();
    expect(mockedOrder.update).toHaveBeenCalled();
  });

  it("ordem sem job vinculado: rejeita se vierem gramas reais mesmo assim (não há reserva para reconciliar)", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      jobId: null,
      job: null,
    } as never);

    await expect(
      completeProduction(
        "po1",
        { actualHours: "3", filamentActuals: [{ filamentId: "fil1", actualGrams: "10" }] },
        "actor1",
      ),
    ).rejects.toThrow(/não tem job vinculado/i);
  });
});

// --- createManualProductionOrder ------------------------------------------------

describe("createManualProductionOrder", () => {
  beforeEach(resetMocks);

  it("rejeita oportunidade inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue(null);
    await expect(
      createManualProductionOrder({ opportunityId: "op1" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita quando a oportunidade não tem versão de orçamento aprovada", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedHasApprovedQuoteVersion.mockResolvedValue(false);

    await expect(
      createManualProductionOrder({ opportunityId: "op1" }, "actor1"),
    ).rejects.toThrow(/orçamento aprovada/i);
  });

  it("rejeita quando já existe uma ordem de produção para a oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedHasApprovedQuoteVersion.mockResolvedValue(true);
    mockedOrder.findFirst.mockResolvedValue({ id: "existing" } as never);

    await expect(
      createManualProductionOrder({ opportunityId: "op1" }, "actor1"),
    ).rejects.toThrow(/já existe uma ordem/i);
  });

  it("cria a ordem manual (sem job) quando há orçamento aprovado e nenhuma ordem prévia", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1" } as never);
    mockedHasApprovedQuoteVersion.mockResolvedValue(true);
    mockedOrder.findFirst.mockResolvedValue(null);
    mockedOrder.create.mockResolvedValue({ id: "po1" } as never);

    await createManualProductionOrder({ opportunityId: "op1", printerId: "printer1" }, "actor1");

    expect(mockedOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ opportunityId: "op1", jobId: null, printerId: "printer1" }),
      }),
    );
  });
});

// --- updateProductionOrderDetails -------------------------------------------------

describe("updateProductionOrderDetails", () => {
  beforeEach(resetMocks);

  it("rejeita ordem inexistente", async () => {
    mockedOrder.findUnique.mockResolvedValue(null);
    await expect(updateProductionOrderDetails("missing", {}, "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it("rejeita editar uma ordem já concluída", async () => {
    mockedOrder.findUnique.mockResolvedValue({ id: "po1", printStatus: "CONCLUIDA" } as never);
    await expect(updateProductionOrderDetails("po1", {}, "actor1")).rejects.toThrow(/já foi concluída/i);
  });

  it("rejeita tentar setar printStatus=CONCLUIDA por aqui (só completeProduction alcança esse estado)", async () => {
    mockedOrder.findUnique.mockResolvedValue({ id: "po1", printStatus: "AGUARDANDO" } as never);
    await expect(
      updateProductionOrderDetails("po1", { printStatus: "CONCLUIDA" }, "actor1"),
    ).rejects.toThrow(/conclua a produção/i);
  });

  it("atualiza os dados técnicos permitidos", async () => {
    mockedOrder.findUnique.mockResolvedValue({
      id: "po1",
      printStatus: "AGUARDANDO",
      printerId: null,
      responsibleId: null,
      plannedStartAt: null,
      plannedEndAt: null,
      technicalNotes: null,
    } as never);
    mockedOrder.update.mockResolvedValue({ id: "po1", printStatus: "IMPRIMINDO" } as never);

    await updateProductionOrderDetails("po1", { printerId: "printer1", printStatus: "IMPRIMINDO" }, "actor1");

    expect(mockedOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "po1" },
        data: expect.objectContaining({ printerId: "printer1", printStatus: "IMPRIMINDO" }),
      }),
    );
  });
});

// --- hasCompletedProductionOrder ---------------------------------------------------

describe("hasCompletedProductionOrder", () => {
  beforeEach(resetMocks);

  it("retorna true quando existe uma ordem CONCLUIDA vinculada à oportunidade", async () => {
    mockedOrder.findFirst.mockResolvedValue({ id: "po1" } as never);
    await expect(hasCompletedProductionOrder("op1")).resolves.toBe(true);
    expect(mockedOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op1", printStatus: "CONCLUIDA" } }),
    );
  });

  it("retorna false quando não existe nenhuma", async () => {
    mockedOrder.findFirst.mockResolvedValue(null);
    await expect(hasCompletedProductionOrder("op1")).resolves.toBe(false);
  });
});
