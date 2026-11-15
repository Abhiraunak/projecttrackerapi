-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ticketHash" TEXT,
    "ticketExpiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialTopUp" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "billId" TEXT,
    "billVersion" INTEGER,
    "billFormat" TEXT,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_ticketHash_key" ON "PasswordReset"("ticketHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MaterialTopUp_purchaseId_date_idx" ON "MaterialTopUp"("purchaseId", "date");

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTopUp" ADD CONSTRAINT "MaterialTopUp_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MaterialPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
