/*
  Warnings:

  - You are about to drop the column `addedById` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `materialId` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `rows` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `MaterialEstimate` table. All the data in the column will be lost.
  - You are about to drop the column `wastagePercent` on the `MaterialEstimate` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "MaterialEstimate" DROP CONSTRAINT "MaterialEstimate_addedById_fkey";

-- DropForeignKey
ALTER TABLE "MaterialEstimate" DROP CONSTRAINT "MaterialEstimate_materialId_fkey";

-- DropIndex
DROP INDEX "MaterialEstimate_projectId_materialId_idx";

-- AlterTable
ALTER TABLE "AttendanceWorker" ADD COLUMN     "otRate" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "MaterialEstimate" DROP COLUMN "addedById",
DROP COLUMN "materialId",
DROP COLUMN "method",
DROP COLUMN "notes",
DROP COLUMN "quantity",
DROP COLUMN "rows",
DROP COLUMN "title",
DROP COLUMN "wastagePercent",
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Untitled estimate';

-- CreateTable
CREATE TABLE "MaterialEstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "purchaseId" TEXT,
    "sentName" TEXT,
    "sentQuantity" DECIMAL(14,3),
    "sentRate" DECIMAL(14,2),

    CONSTRAINT "MaterialEstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourQuote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'sqft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialEstimateLine_estimateId_position_idx" ON "MaterialEstimateLine"("estimateId", "position");

-- CreateIndex
CREATE INDEX "MaterialEstimateLine_purchaseId_idx" ON "MaterialEstimateLine"("purchaseId");

-- CreateIndex
CREATE INDEX "LabourQuote_projectId_taskId_idx" ON "LabourQuote"("projectId", "taskId");

-- CreateIndex
CREATE INDEX "MaterialEstimate_projectId_idx" ON "MaterialEstimate"("projectId");

-- AddForeignKey
ALTER TABLE "MaterialEstimateLine" ADD CONSTRAINT "MaterialEstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "MaterialEstimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialEstimateLine" ADD CONSTRAINT "MaterialEstimateLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MaterialPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourQuote" ADD CONSTRAINT "LabourQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
