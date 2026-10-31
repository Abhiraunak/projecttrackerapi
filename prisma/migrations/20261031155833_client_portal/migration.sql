-- CreateEnum
CREATE TYPE "InstalmentKind" AS ENUM ('ADVANCE', 'INSTALMENT');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DelayReason" AS ENUM ('MONSOON', 'FESTIVAL', 'NATURAL', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "advanceOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectClient" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectClient_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "PaymentInstalment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "InstalmentKind" NOT NULL DEFAULT 'INSTALMENT',
    "amount" DECIMAL(14,2) NOT NULL,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dueDate" DATE,
    "dueAtProgress" INTEGER,
    "requestedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProof" (
    "id" TEXT NOT NULL,
    "instalmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "publicId" TEXT,
    "version" INTEGER,
    "format" TEXT,
    "bytes" INTEGER,
    "status" "ProofStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDelay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" "DelayReason" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "fromDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "tasksMoved" INTEGER NOT NULL DEFAULT 0,
    "paymentsMoved" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDelay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectClient_userId_idx" ON "ProjectClient"("userId");

-- CreateIndex
CREATE INDEX "PaymentInstalment_projectId_dueDate_idx" ON "PaymentInstalment"("projectId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInstalment_projectId_number_key" ON "PaymentInstalment"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProof_publicId_key" ON "PaymentProof"("publicId");

-- CreateIndex
CREATE INDEX "PaymentProof_projectId_status_idx" ON "PaymentProof"("projectId", "status");

-- CreateIndex
CREATE INDEX "PaymentProof_status_createdAt_idx" ON "PaymentProof"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProof_instalmentId_idx" ON "PaymentProof"("instalmentId");

-- CreateIndex
CREATE INDEX "ProjectDelay_projectId_createdAt_idx" ON "ProjectDelay"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_key_key" ON "Notification"("userId", "key");

-- AddForeignKey
ALTER TABLE "ProjectClient" ADD CONSTRAINT "ProjectClient_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClient" ADD CONSTRAINT "ProjectClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInstalment" ADD CONSTRAINT "PaymentInstalment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "PaymentInstalment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDelay" ADD CONSTRAINT "ProjectDelay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDelay" ADD CONSTRAINT "ProjectDelay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
