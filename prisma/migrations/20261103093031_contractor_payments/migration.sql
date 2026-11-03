-- CreateTable
CREATE TABLE "ContractorPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT '',
    "contractorName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "proofId" TEXT,
    "proofVersion" INTEGER,
    "proofFormat" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractorPayment_projectId_date_idx" ON "ContractorPayment"("projectId", "date");

-- CreateIndex
CREATE INDEX "ContractorPayment_projectId_trade_contractorName_idx" ON "ContractorPayment"("projectId", "trade", "contractorName");

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorPayment" ADD CONSTRAINT "ContractorPayment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
