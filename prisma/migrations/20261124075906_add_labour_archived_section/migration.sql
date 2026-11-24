-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContractorPayment" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "measureId" TEXT;

-- AlterTable
ALTER TABLE "LabourMeasure" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LabourProgress" (
    "id" TEXT NOT NULL,
    "measureId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "done" DECIMAL(14,3) NOT NULL,
    "addedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourProgress_measureId_date_idx" ON "LabourProgress"("measureId", "date");

-- CreateIndex
CREATE INDEX "ContractorPayment_measureId_idx" ON "ContractorPayment"("measureId");

-- AddForeignKey
ALTER TABLE "LabourProgress" ADD CONSTRAINT "LabourProgress_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "LabourMeasure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "LabourMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
