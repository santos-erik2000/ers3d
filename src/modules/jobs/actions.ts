"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import {
  BusinessRuleError,
  createJob,
  createProject,
  getJobById,
  type JobFilamentInput,
  type JobInput,
  type ProjectInput,
} from "@/modules/jobs/services/jobs";
import { Prisma, type ProjectStatus } from "@prisma/client";

export type ProjectFormState = { error?: string } | undefined;

const PROJECT_STATUSES: ProjectStatus[] = ["PLANEJAMENTO", "EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"];

export async function createProjectAction(
  _prevState: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { userId } = await requirePermission(PERMISSIONS.JOBS_MANAGE);

  const statusRaw = String(formData.get("status") ?? "PLANEJAMENTO");
  const status = (PROJECT_STATUSES as string[]).includes(statusRaw) ? (statusRaw as ProjectStatus) : "PLANEJAMENTO";

  const input: ProjectInput = {
    name: String(formData.get("name") ?? "").trim(),
    customerId: String(formData.get("customerId") ?? "") || null,
    description: String(formData.get("description") ?? "").trim() || null,
    category: String(formData.get("category") ?? "").trim() || null,
    responsibleId: String(formData.get("responsibleId") ?? "") || null,
    status,
  };

  if (!input.name) return { error: "Informe o nome do projeto." };

  try {
    await createProject(input, userId);
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/calculadora");
  return undefined;
}

// --- Job (calculadora) --------------------------------------------------------

export type JobFilamentResultView = {
  filamentId: string;
  filamentName: string;
  gramsUsed: string;
  pricePerKgAtTime: string;
  costCalculated: string;
};

export type JobResultView = {
  id: string;
  projectId: string;
  projectName: string;
  ruleVersion: string;
  powerWatts: string;
  printHours: string;
  kwhPrice: string;
  maintenancePct: string;
  safetyPct: string;
  profitPct: string;
  quantityProduced: number;
  filamentsCost: string;
  energyCost: string;
  directCost: string;
  finalPrice: string;
  maintenanceValue: string;
  safetyValue: string;
  profitValue: string;
  filaments: JobFilamentResultView[];
  createdAt: string;
};

export type JobFormState = { error?: string; job?: JobResultView } | undefined;

/**
 * Converte um percentual digitado pelo usuário ("20") para a fração 0-1
 * armazenada no domínio (0.20) — usando `Prisma.Decimal` sobre a string bruta
 * do formulário, nunca `Number()`/float em nenhum passo (regra do CLAUDE.md).
 * A UI nunca pede o decimal diretamente ao usuário (design system, Etapa 4).
 */
function percentToFraction(raw: string): string {
  const value = raw.trim() || "0";
  return new Prisma.Decimal(value).dividedBy(100).toString();
}

function parseJobFilaments(formData: FormData): JobFilamentInput[] {
  const rowCount = Number(formData.get("filamentRows") ?? "0");
  const filaments: JobFilamentInput[] = [];
  for (let i = 0; i < rowCount; i++) {
    const filamentId = String(formData.get(`filaments.${i}.filamentId`) ?? "").trim();
    const gramsRaw = String(formData.get(`filaments.${i}.grams`) ?? "").trim();
    if (!filamentId || !gramsRaw) continue;
    filaments.push({ filamentId, gramsUsed: gramsRaw });
  }
  return filaments;
}

export async function createJobAction(_prevState: JobFormState, formData: FormData): Promise<JobFormState> {
  const { userId } = await requirePermission(PERMISSIONS.JOBS_MANAGE);

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Selecione o projeto." };

  const powerWatts = String(formData.get("powerWatts") ?? "0") || "0";
  const printHours = String(formData.get("printHours") ?? "0") || "0";
  const kwhPrice = String(formData.get("kwhPrice") ?? "0") || "0";
  const maintenancePct = percentToFraction(String(formData.get("maintenancePct") ?? "0"));
  const safetyPct = percentToFraction(String(formData.get("safetyPct") ?? "0"));
  const profitPct = percentToFraction(String(formData.get("profitPct") ?? "0"));
  const quantityRaw = String(formData.get("quantityProduced") ?? "1");
  const quantityProduced = Number.parseInt(quantityRaw, 10) || 1;

  const filaments = parseJobFilaments(formData);
  if (filaments.length === 0) {
    return { error: "Selecione ao menos um filamento com gramas utilizadas." };
  }

  const input: JobInput = {
    projectId,
    powerWatts,
    printHours,
    kwhPrice,
    maintenancePct,
    safetyPct,
    profitPct,
    quantityProduced,
    filaments,
  };

  let jobId: string;
  try {
    const job = await createJob(input, userId);
    jobId = job.id;
  } catch (error) {
    if (error instanceof BusinessRuleError) return { error: error.message };
    throw error;
  }

  revalidatePath("/calculadora");

  const full = await getJobById(jobId);
  if (!full) return { error: "Job criado, mas não foi possível carregar o resultado." };

  const jobView: JobResultView = {
    id: full.id,
    projectId: full.projectId,
    projectName: full.project.name,
    ruleVersion: full.ruleVersion,
    powerWatts: full.powerWatts.toString(),
    printHours: full.printHours.toString(),
    kwhPrice: full.kwhPrice.toString(),
    maintenancePct: full.maintenancePct.toString(),
    safetyPct: full.safetyPct.toString(),
    profitPct: full.profitPct.toString(),
    quantityProduced: full.quantityProduced,
    filamentsCost: full.filamentsCost.toString(),
    energyCost: full.energyCost.toString(),
    directCost: full.directCost.toString(),
    finalPrice: full.finalPrice.toString(),
    maintenanceValue: full.maintenanceValue.toString(),
    safetyValue: full.safetyValue.toString(),
    profitValue: full.profitValue.toString(),
    filaments: full.jobFilaments.map((jf) => ({
      filamentId: jf.filamentId,
      filamentName: jf.filament.name,
      gramsUsed: jf.gramsUsed.toString(),
      pricePerKgAtTime: jf.pricePerKgAtTime.toString(),
      costCalculated: jf.costCalculated.toString(),
    })),
    createdAt: full.createdAt.toISOString(),
  };

  return { job: jobView };
}
