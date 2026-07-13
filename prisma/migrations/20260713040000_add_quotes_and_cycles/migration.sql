-- CreateEnum
CREATE TYPE "CrmCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "carriedFromCycleId" TEXT,
ADD COLUMN     "cycleId" TEXT;

-- CreateTable
CREATE TABLE "crm_cycles" (
    "id" TEXT NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "status" "CrmCycleStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedById" TEXT,

    CONSTRAINT "crm_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "opportunityId" TEXT NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "manualJustification" TEXT,
    "originalValue" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalValue" DECIMAL(12,2) NOT NULL,
    "paymentTerms" TEXT,
    "deliveryDeadline" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "jobId" TEXT,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_cycles_referenceMonth_key" ON "crm_cycles"("referenceMonth");

-- CreateIndex
CREATE INDEX "quotes_opportunityId_idx" ON "quotes"("opportunityId");

-- CreateIndex
CREATE INDEX "quote_versions_quoteId_idx" ON "quote_versions"("quoteId");

-- CreateIndex
CREATE INDEX "quote_versions_jobId_idx" ON "quote_versions"("jobId");

-- CreateIndex
CREATE INDEX "quote_versions_status_idx" ON "quote_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_quoteId_versionNumber_key" ON "quote_versions"("quoteId", "versionNumber");

-- CreateIndex
CREATE INDEX "opportunities_cycleId_idx" ON "opportunities"("cycleId");

-- CreateIndex
CREATE INDEX "opportunities_carriedFromCycleId_idx" ON "opportunities"("carriedFromCycleId");

-- AddForeignKey
ALTER TABLE "crm_cycles" ADD CONSTRAINT "crm_cycles_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "crm_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_carriedFromCycleId_fkey" FOREIGN KEY ("carriedFromCycleId") REFERENCES "crm_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

