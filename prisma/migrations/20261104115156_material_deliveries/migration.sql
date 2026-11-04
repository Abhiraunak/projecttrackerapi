-- AlterTable
ALTER TABLE "MaterialPurchase" ADD COLUMN     "section" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "MaterialDelivery" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "billId" TEXT,
    "billVersion" INTEGER,
    "billFormat" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialDelivery_purchaseId_date_idx" ON "MaterialDelivery"("purchaseId", "date");

-- CreateIndex
CREATE INDEX "MaterialPurchase_projectId_section_idx" ON "MaterialPurchase"("projectId", "section");

-- AddForeignKey
ALTER TABLE "MaterialDelivery" ADD CONSTRAINT "MaterialDelivery_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MaterialPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialDelivery" ADD CONSTRAINT "MaterialDelivery_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
