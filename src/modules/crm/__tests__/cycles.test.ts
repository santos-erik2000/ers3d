import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const crmCycle = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const opportunity = { findMany: vi.fn(), update: vi.fn() };
  const prismaMock: Record<string, unknown> = { crmCycle, opportunity };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  closeCycle,
  getOrCreateOpenCycle,
} from "@/modules/crm/services/cycles";

const mockedCrmCycle = vi.mocked(prisma.crmCycle);
const mockedOpportunity = vi.mocked(prisma.opportunity);

function resetMocks() {
  mockedCrmCycle.findFirst.mockReset();
  mockedCrmCycle.findUnique.mockReset();
  mockedCrmCycle.create.mockReset();
  mockedCrmCycle.update.mockReset();
  mockedOpportunity.findMany.mockReset();
  mockedOpportunity.update.mockReset();
  vi.mocked(recordAudit).mockReset();
}

describe("getOrCreateOpenCycle", () => {
  beforeEach(resetMocks);

  it("retorna o ciclo aberto existente sem criar um novo", async () => {
    mockedCrmCycle.findFirst.mockResolvedValue({ id: "cycle1", status: "OPEN" } as never);

    const cycle = await getOrCreateOpenCycle();

    expect(cycle).toMatchObject({ id: "cycle1" });
    expect(mockedCrmCycle.create).not.toHaveBeenCalled();
  });

  it("cria o primeiro ciclo (mês corrente) quando nenhum ciclo aberto existe", async () => {
    mockedCrmCycle.findFirst.mockResolvedValue(null);
    mockedCrmCycle.create.mockResolvedValue({ id: "cycle-new", status: "OPEN" } as never);

    const cycle = await getOrCreateOpenCycle();

    expect(cycle).toMatchObject({ id: "cycle-new" });
    expect(mockedCrmCycle.create).toHaveBeenCalledTimes(1);
  });
});

// --- closeCycle: caso crítico CRM-5 (fechamento nunca destrutivo) --------------

describe("closeCycle — CRM-5 (caso crítico: fechamento mensal com cards abertos)", () => {
  beforeEach(resetMocks);

  it("rejeita ciclo inexistente", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue(null);

    await expect(closeCycle("cycle1", [], "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita fechar um ciclo que já está fechado", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue({
      id: "cycle1",
      status: "CLOSED",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);

    await expect(closeCycle("cycle1", [], "actor1")).rejects.toThrow(/já está fechado/i);
  });

  it("rejeita o fechamento quando falta decisão para algum card em aberto — nenhum card pode ficar sem decisão", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue({
      id: "cycle1",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.findMany.mockResolvedValue([{ id: "op1" }, { id: "op2" }] as never);

    await expect(
      closeCycle("cycle1", [{ opportunityId: "op1", decision: "TRANSPORT" }], "actor1"),
    ).rejects.toThrow(/decidir/i);

    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedCrmCycle.update).not.toHaveBeenCalled();
  });

  it("rejeita decisão sobre uma oportunidade que não pertence aos cards em aberto do ciclo", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue({
      id: "cycle1",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.findMany.mockResolvedValue([{ id: "op1" }] as never);

    await expect(
      closeCycle("cycle1", [{ opportunityId: "does-not-belong", decision: "TRANSPORT" }], "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    expect(mockedOpportunity.update).not.toHaveBeenCalled();
  });

  it("com todas as decisões informadas: transporta, marca pendência carregada e nenhum card desaparece", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue({
      id: "cycle1",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.findMany.mockResolvedValue([{ id: "op1" }, { id: "op2" }] as never);
    mockedCrmCycle.findFirst.mockResolvedValue(null); // próximo ciclo ainda não existe
    mockedCrmCycle.create.mockResolvedValue({ id: "cycle2", status: "OPEN" } as never);
    mockedOpportunity.update.mockResolvedValue({} as never);
    mockedCrmCycle.update.mockResolvedValue({ id: "cycle1", status: "CLOSED" } as never);

    const result = await closeCycle(
      "cycle1",
      [
        { opportunityId: "op1", decision: "TRANSPORT" },
        { opportunityId: "op2", decision: "CARRY_AS_PENDING" },
      ],
      "actor1",
    );

    expect(result).toMatchObject({ id: "cycle1", status: "CLOSED" });

    // "Transportar": segue no novo ciclo, sem marcação de pendência.
    expect(mockedOpportunity.update).toHaveBeenCalledWith({
      where: { id: "op1" },
      data: { cycleId: "cycle2", carriedFromCycleId: null },
    });
    // "Pendência carregada": segue no novo ciclo, mas marcada com o ciclo antigo.
    expect(mockedOpportunity.update).toHaveBeenCalledWith({
      where: { id: "op2" },
      data: { cycleId: "cycle2", carriedFromCycleId: "cycle1" },
    });

    // Nenhum card foi apagado — só reatribuído a um novo ciclo (mesma linha).
    expect(mockedOpportunity.update).toHaveBeenCalledTimes(2);

    expect(mockedCrmCycle.update).toHaveBeenCalledWith({
      where: { id: "cycle1" },
      data: expect.objectContaining({ status: "CLOSED", closedById: "actor1" }),
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "crm_cycle", action: "crm_cycle.close", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("fecha sem nenhum card em aberto (lista de decisões vazia é suficiente)", async () => {
    mockedCrmCycle.findUnique.mockResolvedValue({
      id: "cycle1",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.findMany.mockResolvedValue([]);
    mockedCrmCycle.findFirst.mockResolvedValue({ id: "cycle2", status: "OPEN" } as never);
    mockedCrmCycle.update.mockResolvedValue({ id: "cycle1", status: "CLOSED" } as never);

    const result = await closeCycle("cycle1", [], "actor1");

    expect(result).toMatchObject({ id: "cycle1", status: "CLOSED" });
    expect(mockedCrmCycle.create).not.toHaveBeenCalled(); // reaproveita o ciclo do mês seguinte já existente
    expect(mockedOpportunity.update).not.toHaveBeenCalled();
  });
});
