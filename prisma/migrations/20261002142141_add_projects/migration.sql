-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ONGOING', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ONGOING',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "work" TEXT NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "contractorRate" DOUBLE PRECISION NOT NULL,
    "inHouseRate" DOUBLE PRECISION NOT NULL,
    "stipulated" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_ownerId_status_updatedAt_idx" ON "Project"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_projectId_position_idx" ON "Task"("projectId", "position");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
