-- CreateTable
CREATE TABLE "MaterialPurchase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "billId" TEXT,
    "billVersion" INTEGER,
    "billFormat" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialPurchase_projectId_date_idx" ON "MaterialPurchase"("projectId", "date");

-- AddForeignKey
ALTER TABLE "MaterialPurchase" ADD CONSTRAINT "MaterialPurchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialPurchase" ADD CONSTRAINT "MaterialPurchase_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
