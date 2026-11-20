-- CreateTable
CREATE TABLE "EquipmentHireChange" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(12,2),
    "amount" DECIMAL(14,2),
    "projectId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentHireChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentHireChange_equipmentId_date_idx" ON "EquipmentHireChange"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "EquipmentHireChange_projectId_idx" ON "EquipmentHireChange"("projectId");

-- AddForeignKey
ALTER TABLE "EquipmentHireChange" ADD CONSTRAINT "EquipmentHireChange_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentHireChange" ADD CONSTRAINT "EquipmentHireChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
