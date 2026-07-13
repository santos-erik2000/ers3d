-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('PROPOSTA', 'NEGOCIACAO', 'DESENVOLVIMENTO', 'QUALIDADE', 'ENTREGA', 'CONCLUIDO');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OpportunityFinancialStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'PROPOSTA',
    "priority" "OpportunityPriority" NOT NULL DEFAULT 'MEDIUM',
    "financialStatus" "OpportunityFinancialStatus" NOT NULL DEFAULT 'PENDING',
    "deadlineAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "ownerId" TEXT,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_history" (
    "id" TEXT NOT NULL,
    "fromStage" "OpportunityStage",
    "toStage" "OpportunityStage" NOT NULL,
    "note" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "opportunity_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_customerId_idx" ON "opportunities"("customerId");

-- CreateIndex
CREATE INDEX "opportunities_ownerId_idx" ON "opportunities"("ownerId");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunities_deadlineAt_idx" ON "opportunities"("deadlineAt");

-- CreateIndex
CREATE INDEX "opportunity_stage_history_opportunityId_idx" ON "opportunity_stage_history"("opportunityId");

-- CreateIndex
CREATE INDEX "opportunity_stage_history_userId_idx" ON "opportunity_stage_history"("userId");

-- CreateIndex
CREATE INDEX "opportunity_stage_history_movedAt_idx" ON "opportunity_stage_history"("movedAt");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

