/*
  Warnings:

  - A unique constraint covering the columns `[projectId,number,revision]` on the table `Drawing` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PunchType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('ACCEPTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LocationCheck" AS ENUM ('ON_SITE', 'OFF_SITE', 'NO_LOCATION', 'SITE_NOT_SET');

-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN     "current" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "firmName" TEXT,
ADD COLUMN     "siteLat" DOUBLE PRECISION,
ADD COLUMN     "siteLng" DOUBLE PRECISION,
ADD COLUMN     "siteRadiusM" INTEGER NOT NULL DEFAULT 200;

-- CreateTable
CREATE TABLE "StaffPunch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PunchType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT,
    "place" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "plusCode" TEXT,
    "distanceM" INTEGER,
    "outsideSite" BOOLEAN NOT NULL DEFAULT false,
    "publicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorId" TEXT,
    "challanNo" TEXT NOT NULL DEFAULT '',
    "vehicleNo" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" "DeliveryStatus" NOT NULL,
    "locationCheck" "LocationCheck" NOT NULL,
    "distanceM" INTEGER,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "receivedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "movementId" TEXT,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPhoto" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "plusCode" TEXT,
    "distanceM" INTEGER,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPunch_publicId_key" ON "StaffPunch"("publicId");

-- CreateIndex
CREATE INDEX "StaffPunch_userId_at_idx" ON "StaffPunch"("userId", "at" DESC);

-- CreateIndex
CREATE INDEX "StaffPunch_at_idx" ON "StaffPunch"("at");

-- CreateIndex
CREATE INDEX "Delivery_projectId_createdAt_idx" ON "Delivery"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Delivery_status_createdAt_idx" ON "Delivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLine_movementId_key" ON "DeliveryLine"("movementId");

-- CreateIndex
CREATE INDEX "DeliveryLine_deliveryId_idx" ON "DeliveryLine"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPhoto_publicId_key" ON "DeliveryPhoto"("publicId");

-- CreateIndex
CREATE INDEX "DeliveryPhoto_deliveryId_idx" ON "DeliveryPhoto"("deliveryId");

-- CreateIndex
CREATE INDEX "Drawing_projectId_current_idx" ON "Drawing"("projectId", "current");

-- CreateIndex
CREATE UNIQUE INDEX "Drawing_projectId_number_revision_key" ON "Drawing"("projectId", "number", "revision");

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPunch" ADD CONSTRAINT "StaffPunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPunch" ADD CONSTRAINT "StaffPunch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MaterialOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPhoto" ADD CONSTRAINT "DeliveryPhoto_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
