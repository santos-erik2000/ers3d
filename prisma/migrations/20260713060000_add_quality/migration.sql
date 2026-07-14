-- CreateEnum
CREATE TYPE "QualityCheckResult" AS ENUM ('APROVADO', 'REPROVADO', 'APROVADO_COM_RESSALVA');

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "result" "QualityCheckResult" NOT NULL,
    "rejectionReason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "checkedById" TEXT,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_check_items" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "notes" TEXT,
    "evidencePhotoUrl" TEXT,
    "qualityCheckId" TEXT NOT NULL,

    CONSTRAINT "quality_check_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_checks_opportunityId_idx" ON "quality_checks"("opportunityId");

-- CreateIndex
CREATE INDEX "quality_checks_productionOrderId_idx" ON "quality_checks"("productionOrderId");

-- CreateIndex
CREATE INDEX "quality_checks_checkedById_idx" ON "quality_checks"("checkedById");

-- CreateIndex
CREATE INDEX "quality_checks_checkedAt_idx" ON "quality_checks"("checkedAt");

-- CreateIndex
CREATE INDEX "quality_check_items_qualityCheckId_idx" ON "quality_check_items"("qualityCheckId");

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_check_items" ADD CONSTRAINT "quality_check_items_qualityCheckId_fkey" FOREIGN KEY ("qualityCheckId") REFERENCES "quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
