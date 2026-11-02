-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "serialNo" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "code" TEXT,
    "ownership" TEXT NOT NULL DEFAULT 'owned',
    "hireRate" DECIMAL(12,2),
    "hirePer" TEXT NOT NULL DEFAULT 'day',
    "supplier" TEXT,
    "serviceDue" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMove" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromProjectId" TEXT,
    "toProjectId" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "note" TEXT NOT NULL DEFAULT '',
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_serialNo_key" ON "Equipment"("serialNo");

-- CreateIndex
CREATE INDEX "Equipment_category_retired_idx" ON "Equipment"("category", "retired");

-- CreateIndex
CREATE INDEX "EquipmentMove_equipmentId_date_idx" ON "EquipmentMove"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "EquipmentMove_toProjectId_idx" ON "EquipmentMove"("toProjectId");

-- CreateIndex
CREATE INDEX "EquipmentMove_fromProjectId_idx" ON "EquipmentMove"("fromProjectId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMove" ADD CONSTRAINT "EquipmentMove_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMove" ADD CONSTRAINT "EquipmentMove_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMove" ADD CONSTRAINT "EquipmentMove_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMove" ADD CONSTRAINT "EquipmentMove_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
