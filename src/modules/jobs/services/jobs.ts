import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import { calculatePrice, type PricingInput } from "@/modules/jobs/services/pricing";
import { Prisma, type Job, type Project, type ProjectStatus } from "@prisma/client";

export class BusinessRuleError extends Error {}

// --- Project -----------------------------------------------------------------

export type ProjectInput = {
  name: string;
  customerId?: string | null;
  description?: string | null;
  category?: string | null;
  responsibleId?: string | null;
  status?: ProjectStatus;
};

export async function createProject(input: ProjectInput, actorUserId: string): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new BusinessRuleError("Informe o nome do projeto.");

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name,
        customerId: input.customerId || null,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        responsibleId: input.responsibleId || null,
        status: input.status ?? "PLANEJAMENTO",
      },
    });

    await recordAudit(
      {
        entityType: "project",
        entityId: project.id,
        action: "project.create",
        after: {
          name,
          customerId: project.customerId,
          category: project.category,
          status: project.status,
        },
        userId: actorUserId,
      },
      tx,
    );

    return project;
  });

  return created;
}

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, name: true } },
      responsible: { select: { id: true, name: true } },
      jobs: { select: { id: true } },
    },
  });
}

export async function getProjectById(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      responsible: { select: { id: true, name: true } },
      jobs: { orderBy: { createdAt: "desc" }, include: { jobFilaments: { include: { filament: true } } } },
    },
  });
}

// --- Job (calculadora) --------------------------------------------------------

export type JobFilamentInput = {
  filamentId: string;
  gramsUsed: Prisma.Decimal.Value;
};

export type JobInput = {
  projectId: string;
  powerWatts: Prisma.Decimal.Value;
  printHours: Prisma.Decimal.Value;
  kwhPrice: Prisma.Decimal.Value;
  // Fração 0-1 — já convertida de "20" para 0.20 pela camada de action/UI.
  maintenancePct: Prisma.Decimal.Value;
  safetyPct: Prisma.Decimal.Value;
  profitPct: Prisma.Decimal.Value;
  quantityProduced?: number;
  // Reservados para o orçamento (Sprint 5) — não entram no cálculo ainda.
  discount?: Prisma.Decimal.Value | null;
  freight?: Prisma.Decimal.Value | null;
  taxes?: Prisma.Decimal.Value | null;
  additionalCosts?: Prisma.Decimal.Value | null;
  filaments: JobFilamentInput[];
};

function toNullableDecimal(value: Prisma.Decimal.Value | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  return new Prisma.Decimal(value);
}

/**
 * Cria um Job de cálculo (calculadora de precificação — CALC-2). Busca o
 * preço/kg atual de cada filamento selecionado no banco, roda o motor puro
 * `calculatePrice` e persiste entradas + resultado de forma imutável, com a
 * versão da regra de cálculo aplicada (`ruleVersion`). Rejeita com
 * `BusinessRuleError` (mensagem clara, propagada do motor) quando a soma dos
 * percentuais é >= 100% — nenhum job é salvo nesse caso (CALC-3).
 *
 * TODO (Sprint 6 — módulo de produção/ordens reais): este Job é uma
 * SIMULAÇÃO de custo/preço da calculadora — ele NÃO debita nem reserva
 * `Filament.availableGrams`. A decisão de negócio (Etapa 1 §03, "Política de
 * estoque") é que a reserva de fato só acontece quando uma oportunidade do
 * Kanban CRM é aprovada e gera uma ordem de produção real (épico E5,
 * história PROD-1) — nessa hora sim, `FilamentMovement` ganha os tipos
 * "RESERVA"/"LIBERACAO" e passa a referenciar o job real. Não simular esse
 * débito aqui, para não inventar uma regra de estoque que ainda não existe.
 */
export async function createJob(input: JobInput, actorUserId: string): Promise<Job> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new BusinessRuleError("Projeto não encontrado.");

  if (!input.filaments || input.filaments.length === 0) {
    throw new BusinessRuleError("Selecione ao menos um filamento com gramas utilizadas.");
  }

  const filamentIds = [...new Set(input.filaments.map((f) => f.filamentId))];
  const filaments = await prisma.filament.findMany({ where: { id: { in: filamentIds } } });
  if (filaments.length !== filamentIds.length) {
    throw new BusinessRuleError("Um ou mais filamentos selecionados não foram encontrados.");
  }
  const filamentById = new Map(filaments.map((f) => [f.id, f]));

  const pricingInput: PricingInput = {
    powerWatts: input.powerWatts,
    printHours: input.printHours,
    kwhPrice: input.kwhPrice,
    maintenancePct: input.maintenancePct,
    safetyPct: input.safetyPct,
    profitPct: input.profitPct,
    filaments: input.filaments.map((f) => {
      const filament = filamentById.get(f.filamentId);
      if (!filament) throw new BusinessRuleError("Um dos filamentos selecionados não foi encontrado.");
      return { filamentId: f.filamentId, pricePerKg: filament.pricePerKg, gramsUsed: f.gramsUsed };
    }),
  };

  const pricing = calculatePrice(pricingInput);
  if (pricing.rejected) {
    // Caso crítico CALC-3: propaga a mensagem clara do motor, nenhum job é criado.
    throw new BusinessRuleError(pricing.reason);
  }

  const quantityProduced =
    input.quantityProduced && Number.isFinite(input.quantityProduced) && input.quantityProduced > 0
      ? Math.trunc(input.quantityProduced)
      : 1;

  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        projectId: input.projectId,
        powerWatts: new Prisma.Decimal(input.powerWatts),
        printHours: new Prisma.Decimal(input.printHours),
        kwhPrice: new Prisma.Decimal(input.kwhPrice),
        maintenancePct: new Prisma.Decimal(input.maintenancePct),
        safetyPct: new Prisma.Decimal(input.safetyPct),
        profitPct: new Prisma.Decimal(input.profitPct),
        quantityProduced,
        discount: toNullableDecimal(input.discount),
        freight: toNullableDecimal(input.freight),
        taxes: toNullableDecimal(input.taxes),
        additionalCosts: toNullableDecimal(input.additionalCosts),
        ruleVersion: pricing.ruleVersion,
        filamentsCost: pricing.filamentsCost,
        energyCost: pricing.energyCost,
        directCost: pricing.directCost,
        finalPrice: pricing.finalPrice,
        maintenanceValue: pricing.maintenanceValue,
        safetyValue: pricing.safetyValue,
        profitValue: pricing.profitValue,
        jobFilaments: {
          create: pricing.filaments.map((f) => ({
            filamentId: f.filamentId,
            gramsUsed: f.gramsUsed,
            pricePerKgAtTime: f.pricePerKg,
            costCalculated: f.cost,
          })),
        },
      },
      include: { jobFilaments: true },
    });

    await recordAudit(
      {
        entityType: "job",
        entityId: job.id,
        action: "job.create",
        after: {
          projectId: input.projectId,
          ruleVersion: pricing.ruleVersion,
          filamentsCost: pricing.filamentsCost.toString(),
          energyCost: pricing.energyCost.toString(),
          directCost: pricing.directCost.toString(),
          finalPrice: pricing.finalPrice.toString(),
          maintenanceValue: pricing.maintenanceValue.toString(),
          safetyValue: pricing.safetyValue.toString(),
          profitValue: pricing.profitValue.toString(),
        },
        userId: actorUserId,
      },
      tx,
    );

    return job;
  });

  return created;
}

export async function listJobs(projectId?: string) {
  return prisma.job.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      jobFilaments: { include: { filament: { select: { id: true, name: true, material: true, color: true } } } },
    },
  });
}

export async function getJobById(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      project: true,
      jobFilaments: { include: { filament: true } },
    },
  });
}
