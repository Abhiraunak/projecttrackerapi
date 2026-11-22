-- AlterTable
ALTER TABLE "ContractorPayment" ADD COLUMN     "periodFrom" DATE,
ADD COLUMN     "periodTo" DATE;

-- CreateIndex
CREATE INDEX "ContractorPayment_projectId_periodTo_idx" ON "ContractorPayment"("projectId", "periodTo");
