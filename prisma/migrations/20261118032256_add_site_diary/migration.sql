-- CreateTable
CREATE TABLE "SiteReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "engineerId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "distanceM" INTEGER,
    "outsideSite" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReportTeam" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "mistri" INTEGER NOT NULL DEFAULT 0,
    "labour" INTEGER NOT NULL DEFAULT 0,
    "inTime" TEXT NOT NULL DEFAULT '',
    "outTime" TEXT NOT NULL DEFAULT '',
    "present" BOOLEAN NOT NULL DEFAULT true,
    "otHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "workDone" TEXT NOT NULL DEFAULT '',
    "materialUsed" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "attendanceId" TEXT,

    CONSTRAINT "SiteReportTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReportArrival" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "purchaseId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "deliveryId" TEXT,

    CONSTRAINT "SiteReportArrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReportPhoto" (
    "id" TEXT NOT NULL,
    "arrivalId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "distanceM" INTEGER,
    "outsideSite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteReportPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteReport_projectId_date_idx" ON "SiteReport"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReport_projectId_date_engineerId_key" ON "SiteReport"("projectId", "date", "engineerId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReportArrival_deliveryId_key" ON "SiteReportArrival"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReportArrival_reportId_clientKey_key" ON "SiteReportArrival"("reportId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReportPhoto_publicId_key" ON "SiteReportPhoto"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReportPhoto_arrivalId_clientKey_key" ON "SiteReportPhoto"("arrivalId", "clientKey");

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReportTeam" ADD CONSTRAINT "SiteReportTeam_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SiteReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReportArrival" ADD CONSTRAINT "SiteReportArrival_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SiteReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReportArrival" ADD CONSTRAINT "SiteReportArrival_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MaterialPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReportArrival" ADD CONSTRAINT "SiteReportArrival_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "MaterialDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReportPhoto" ADD CONSTRAINT "SiteReportPhoto_arrivalId_fkey" FOREIGN KEY ("arrivalId") REFERENCES "SiteReportArrival"("id") ON DELETE CASCADE ON UPDATE CASCADE;
