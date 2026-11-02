-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "trade" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Attendance_projectId_trade_date_idx" ON "Attendance"("projectId", "trade", "date");
