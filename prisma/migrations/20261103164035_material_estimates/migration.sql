-- CreateTable
CREATE TABLE "MaterialEstimate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'quantity',
    "rows" JSONB,
    "wastagePercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(14,3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialEstimate_projectId_materialId_idx" ON "MaterialEstimate"("projectId", "materialId");

-- AddForeignKey
ALTER TABLE "MaterialEstimate" ADD CONSTRAINT "MaterialEstimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialEstimate" ADD CONSTRAINT "MaterialEstimate_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialEstimate" ADD CONSTRAINT "MaterialEstimate_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
