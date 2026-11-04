-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "batchLead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payMode" TEXT NOT NULL DEFAULT 'amount';

-- AlterTable
ALTER TABLE "AttendanceWorker" ADD COLUMN     "hourlyRate" DECIMAL(14,4),
ADD COLUMN     "hours" DECIMAL(6,2),
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "otHours" DECIMAL(6,2);

-- CreateTable
CREATE TABLE "LabourTeamMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayRate" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourTeamMember_projectId_contractorName_active_idx" ON "LabourTeamMember"("projectId", "contractorName", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LabourTeamMember_projectId_contractorName_name_key" ON "LabourTeamMember"("projectId", "contractorName", "name");

-- CreateIndex
CREATE INDEX "Attendance_batchId_idx" ON "Attendance"("batchId");

-- AddForeignKey
ALTER TABLE "LabourTeamMember" ADD CONSTRAINT "LabourTeamMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
