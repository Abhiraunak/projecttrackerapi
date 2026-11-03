-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "billFormat" TEXT,
ADD COLUMN     "billId" TEXT,
ADD COLUMN     "billVersion" INTEGER,
ADD COLUMN     "date" DATE,
ADD COLUMN     "vendorName" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "MaterialPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "materialId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "proofId" TEXT,
    "proofVersion" INTEGER,
    "proofFormat" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialPayment_projectId_date_idx" ON "MaterialPayment"("projectId", "date");

-- CreateIndex
CREATE INDEX "MaterialPayment_projectId_vendorName_idx" ON "MaterialPayment"("projectId", "vendorName");

-- AddForeignKey
ALTER TABLE "MaterialPayment" ADD CONSTRAINT "MaterialPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPayment" ADD CONSTRAINT "MaterialPayment_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPayment" ADD CONSTRAINT "MaterialPayment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
