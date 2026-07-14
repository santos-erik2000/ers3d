-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('ATIVA', 'MANUTENCAO', 'INATIVA');

-- CreateEnum
CREATE TYPE "ProductionPrintStatus" AS ENUM ('AGUARDANDO', 'IMPRIMINDO', 'CONCLUIDA', 'FALHOU');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FilamentMovementType" ADD VALUE 'RESERVA';
ALTER TYPE "FilamentMovementType" ADD VALUE 'LIBERACAO_RESERVA';

-- AlterTable
ALTER TABLE "filament_movements" ADD COLUMN     "productionOrderId" TEXT;

-- AlterTable
ALTER TABLE "job_filaments" ADD COLUMN     "gramsActual" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "printers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PrinterStatus" NOT NULL DEFAULT 'ATIVA',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "printStatus" "ProductionPrintStatus" NOT NULL DEFAULT 'AGUARDANDO',
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualHours" DECIMAL(10,2),
    "technicalNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "jobId" TEXT,
    "printerId" TEXT,
    "responsibleId" TEXT,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "printers_name_key" ON "printers"("name");

-- CreateIndex
CREATE INDEX "production_orders_opportunityId_idx" ON "production_orders"("opportunityId");

-- CreateIndex
CREATE INDEX "production_orders_jobId_idx" ON "production_orders"("jobId");

-- CreateIndex
CREATE INDEX "production_orders_printerId_idx" ON "production_orders"("printerId");

-- CreateIndex
CREATE INDEX "production_orders_responsibleId_idx" ON "production_orders"("responsibleId");

-- CreateIndex
CREATE INDEX "production_orders_printStatus_idx" ON "production_orders"("printStatus");

-- CreateIndex
CREATE INDEX "filament_movements_productionOrderId_idx" ON "filament_movements"("productionOrderId");

-- AddForeignKey
ALTER TABLE "filament_movements" ADD CONSTRAINT "filament_movements_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

