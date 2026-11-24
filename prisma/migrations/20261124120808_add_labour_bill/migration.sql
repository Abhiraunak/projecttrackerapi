-- AlterTable
ALTER TABLE "ContractorPayment" ADD COLUMN     "billId" TEXT;

-- CreateTable
CREATE TABLE "LabourBill" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "addedBy" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourBill_projectId_contractorName_idx" ON "LabourBill"("projectId", "contractorName");

-- CreateIndex
CREATE INDEX "ContractorPayment_billId_idx" ON "ContractorPayment"("billId");

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "LabourBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourBill" ADD CONSTRAINT "LabourBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
