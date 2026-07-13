import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const project = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const filament = {
    findMany: vi.fn(),
  };
  const job = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { project, filament, job };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { BusinessRuleError, createJob, createProject } from "@/modules/jobs/services/jobs";

const mockedProject = vi.mocked(prisma.project);
const mockedFilament = vi.mocked(prisma.filament);
const mockedJob = vi.mocked(prisma.job);

function resetMocks() {
  mockedProject.create.mockReset();
  mockedProject.findMany.mockReset();
  mockedProject.findUnique.mockReset();
  mockedFilament.findMany.mockReset();
  mockedJob.create.mockReset();
  mockedJob.findMany.mockReset();
  mockedJob.findUnique.mockReset();
  vi.mocked(recordAudit).mockReset();
}

const validJobInput = {
  projectId: "proj1",
  powerWatts: "150",
  printHours: "4",
  kwhPrice: "0.80",
  maintenancePct: "0.20",
  safetyPct: "0.10",
  profitPct: "0.30",
  filaments: [{ filamentId: "fil1", gramsUsed: "250" }],
};

describe("createProject", () => {
  beforeEach(resetMocks);

  it("cria o projeto e registra auditoria", async () => {
    mockedProject.create.mockResolvedValue({ id: "proj1", name: "Suporte de câmera" } as never);

    await createProject({ name: "Suporte de câmera" }, "actor1");

    expect(mockedProject.create).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "project", action: "project.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("rejeita nome vazio", async () => {
    await expect(createProject({ name: "   " }, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedProject.create).not.toHaveBeenCalled();
  });
});

describe("createJob", () => {
  beforeEach(resetMocks);

  it("rejeita projeto inexistente", async () => {
    mockedProject.findUnique.mockResolvedValue(null);

    await expect(createJob(validJobInput, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedJob.create).not.toHaveBeenCalled();
  });

  it("rejeita quando nenhum filamento é informado", async () => {
    mockedProject.findUnique.mockResolvedValue({ id: "proj1" } as never);

    await expect(createJob({ ...validJobInput, filaments: [] }, "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mockedJob.create).not.toHaveBeenCalled();
  });

  it("rejeita quando um filamento selecionado não existe no banco", async () => {
    mockedProject.findUnique.mockResolvedValue({ id: "proj1" } as never);
    mockedFilament.findMany.mockResolvedValue([]); // nenhum encontrado

    await expect(createJob(validJobInput, "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedJob.create).not.toHaveBeenCalled();
  });

  it("CALC-3: propaga a rejeição do motor de precificação (soma de percentuais >= 100%) e não cria o job", async () => {
    mockedProject.findUnique.mockResolvedValue({ id: "proj1" } as never);
    mockedFilament.findMany.mockResolvedValue([
      { id: "fil1", pricePerKg: new Prisma.Decimal(120) },
    ] as never);

    await expect(
      createJob({ ...validJobInput, maintenancePct: "0.5", safetyPct: "0.3", profitPct: "0.2" }, "actor1"),
    ).rejects.toThrow(/inferior a 100%/i);

    expect(mockedJob.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("cria o job com as entradas e o resultado calculado persistidos de forma imutável", async () => {
    mockedProject.findUnique.mockResolvedValue({ id: "proj1" } as never);
    mockedFilament.findMany.mockResolvedValue([
      { id: "fil1", pricePerKg: new Prisma.Decimal(120) },
    ] as never);
    mockedJob.create.mockResolvedValue({ id: "job1" } as never);

    await createJob(validJobInput, "actor1");

    expect(mockedJob.create).toHaveBeenCalledTimes(1);
    const callArg = mockedJob.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown> & { jobFilaments: { create: Record<string, unknown>[] } };
    };

    // Entradas imutáveis
    expect((callArg.data.powerWatts as Prisma.Decimal).toString()).toBe("150");
    expect((callArg.data.printHours as Prisma.Decimal).toString()).toBe("4");
    expect((callArg.data.kwhPrice as Prisma.Decimal).toString()).toBe("0.8");
    expect((callArg.data.maintenancePct as Prisma.Decimal).toString()).toBe("0.2");
    expect(callArg.data.ruleVersion).toBe("v1");

    // Resultado calculado (mesmo exemplo verificado à mão do pricing.test.ts)
    expect((callArg.data.filamentsCost as Prisma.Decimal).toString()).toBe("30");
    expect((callArg.data.energyCost as Prisma.Decimal).toString()).toBe("0.48");
    expect((callArg.data.directCost as Prisma.Decimal).toString()).toBe("30.48");
    expect((callArg.data.finalPrice as Prisma.Decimal).toString()).toBe("76.2");

    // job_filaments associativa
    expect(callArg.data.jobFilaments.create).toHaveLength(1);
    const jf = callArg.data.jobFilaments.create[0] as Record<string, unknown>;
    expect(jf.filamentId).toBe("fil1");
    expect((jf.gramsUsed as Prisma.Decimal).toString()).toBe("250");
    expect((jf.pricePerKgAtTime as Prisma.Decimal).toString()).toBe("120");
    expect((jf.costCalculated as Prisma.Decimal).toString()).toBe("30");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "job", action: "job.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("usa o preço/kg atual do filamento no banco (snapshot no momento do cálculo)", async () => {
    mockedProject.findUnique.mockResolvedValue({ id: "proj1" } as never);
    mockedFilament.findMany.mockResolvedValue([
      { id: "fil1", pricePerKg: new Prisma.Decimal(999) },
    ] as never);
    mockedJob.create.mockResolvedValue({ id: "job1" } as never);

    await createJob(validJobInput, "actor1");

    const callArg = mockedJob.create.mock.calls[0]?.[0] as {
      data: { jobFilaments: { create: Record<string, unknown>[] } };
    };
    const jf = callArg.data.jobFilaments.create[0] as Record<string, unknown>;
    expect((jf.pricePerKgAtTime as Prisma.Decimal).toString()).toBe("999");
  });
});
