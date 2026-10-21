-- CreateEnum
CREATE TYPE "BoqStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateTable
CREATE TABLE "Boq" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "boqNumber" TEXT NOT NULL DEFAULT '',
    "status" "BoqStatus" NOT NULL DEFAULT 'DRAFT',
    "grandTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Boq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Boq_updatedAt_idx" ON "Boq"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Boq_status_idx" ON "Boq"("status");

-- AddForeignKey
ALTER TABLE "Boq" ADD CONSTRAINT "Boq_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boq" ADD CONSTRAINT "Boq_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
