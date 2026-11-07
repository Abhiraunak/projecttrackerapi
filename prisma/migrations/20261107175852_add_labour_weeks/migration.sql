-- CreateTable
CREATE TABLE "LabourMeasure" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT '',
    "contractorName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "work" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'sqft',
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourWeek" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT '',
    "contractorName" TEXT NOT NULL,
    "contractorKey" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "settledBy" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourMeasure_projectId_date_idx" ON "LabourMeasure"("projectId", "date");

-- CreateIndex
CREATE INDEX "LabourMeasure_projectId_trade_contractorName_idx" ON "LabourMeasure"("projectId", "trade", "contractorName");

-- CreateIndex
CREATE INDEX "LabourWeek_projectId_weekStart_idx" ON "LabourWeek"("projectId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "LabourWeek_projectId_contractorKey_weekStart_key" ON "LabourWeek"("projectId", "contractorKey", "weekStart");

-- AddForeignKey
ALTER TABLE "LabourMeasure" ADD CONSTRAINT "LabourMeasure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourWeek" ADD CONSTRAINT "LabourWeek_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
