-- AlterTable
ALTER TABLE "MaterialDelivery" ADD COLUMN     "amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rate" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "MaterialDelivery_projectId_idx" ON "MaterialDelivery"("projectId");
