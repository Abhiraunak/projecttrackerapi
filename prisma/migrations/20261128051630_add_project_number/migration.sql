/*
  Warnings:

  - A unique constraint covering the columns `[serialNo]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[number]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "number" TEXT,
ADD COLUMN     "serialNo" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "ProjectPin" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPin_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "ProjectPin_projectId_idx" ON "ProjectPin"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_serialNo_key" ON "Project"("serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "Project_number_key" ON "Project"("number");

-- AddForeignKey
ALTER TABLE "ProjectPin" ADD CONSTRAINT "ProjectPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPin" ADD CONSTRAINT "ProjectPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
