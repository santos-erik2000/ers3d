-- CreateEnum
CREATE TYPE "FilamentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FilamentMovementType" AS ENUM ('ENTRADA', 'AJUSTE', 'PERDA', 'DEVOLUCAO', 'CORRECAO');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANEJAMENTO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "filaments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "material" TEXT NOT NULL,
    "color" TEXT,
    "batch" TEXT,
    "supplier" TEXT,
    "pricePerKg" DECIMAL(12,2) NOT NULL,
    "initialWeightGrams" DECIMAL(10,2) NOT NULL,
    "availableGrams" DECIMAL(10,2) NOT NULL,
    "minStockGrams" DECIMAL(10,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "location" TEXT,
    "status" "FilamentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filament_movements" (
    "id" TEXT NOT NULL,
    "type" "FilamentMovementType" NOT NULL,
    "quantityGrams" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filamentId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "filament_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANEJAMENTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "responsibleId" TEXT,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "powerWatts" DECIMAL(10,2) NOT NULL,
    "printHours" DECIMAL(10,2) NOT NULL,
    "kwhPrice" DECIMAL(12,2) NOT NULL,
    "maintenancePct" DECIMAL(5,4) NOT NULL,
    "safetyPct" DECIMAL(5,4) NOT NULL,
    "profitPct" DECIMAL(5,4) NOT NULL,
    "quantityProduced" INTEGER NOT NULL DEFAULT 1,
    "discount" DECIMAL(12,2),
    "freight" DECIMAL(12,2),
    "taxes" DECIMAL(12,2),
    "additionalCosts" DECIMAL(12,2),
    "ruleVersion" TEXT NOT NULL DEFAULT 'v1',
    "filamentsCost" DECIMAL(12,2) NOT NULL,
    "energyCost" DECIMAL(12,2) NOT NULL,
    "directCost" DECIMAL(12,2) NOT NULL,
    "finalPrice" DECIMAL(12,2) NOT NULL,
    "maintenanceValue" DECIMAL(12,2) NOT NULL,
    "safetyValue" DECIMAL(12,2) NOT NULL,
    "profitValue" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_filaments" (
    "id" TEXT NOT NULL,
    "gramsUsed" DECIMAL(10,2) NOT NULL,
    "pricePerKgAtTime" DECIMAL(12,2) NOT NULL,
    "costCalculated" DECIMAL(12,2) NOT NULL,
    "jobId" TEXT NOT NULL,
    "filamentId" TEXT NOT NULL,

    CONSTRAINT "job_filaments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filaments_status_idx" ON "filaments"("status");

-- CreateIndex
CREATE INDEX "filaments_material_idx" ON "filaments"("material");

-- CreateIndex
CREATE INDEX "filament_movements_filamentId_idx" ON "filament_movements"("filamentId");

-- CreateIndex
CREATE INDEX "filament_movements_userId_idx" ON "filament_movements"("userId");

-- CreateIndex
CREATE INDEX "filament_movements_createdAt_idx" ON "filament_movements"("createdAt");

-- CreateIndex
CREATE INDEX "projects_customerId_idx" ON "projects"("customerId");

-- CreateIndex
CREATE INDEX "projects_responsibleId_idx" ON "projects"("responsibleId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "jobs_projectId_idx" ON "jobs"("projectId");

-- CreateIndex
CREATE INDEX "job_filaments_jobId_idx" ON "job_filaments"("jobId");

-- CreateIndex
CREATE INDEX "job_filaments_filamentId_idx" ON "job_filaments"("filamentId");

-- AddForeignKey
ALTER TABLE "filament_movements" ADD CONSTRAINT "filament_movements_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "filaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filament_movements" ADD CONSTRAINT "filament_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_filaments" ADD CONSTRAINT "job_filaments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_filaments" ADD CONSTRAINT "job_filaments_filamentId_fkey" FOREIGN KEY ("filamentId") REFERENCES "filaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

