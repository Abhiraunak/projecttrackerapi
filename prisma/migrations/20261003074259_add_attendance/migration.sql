-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "extras" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceWorker" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttendanceWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attendance_ownerId_createdAt_idx" ON "Attendance"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Attendance_projectId_createdAt_idx" ON "Attendance"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AttendanceWorker_attendanceId_position_idx" ON "AttendanceWorker"("attendanceId", "position");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceWorker" ADD CONSTRAINT "AttendanceWorker_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
