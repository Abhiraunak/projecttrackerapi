-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "Attendance_projectId_taskId_idx" ON "Attendance"("projectId", "taskId");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
