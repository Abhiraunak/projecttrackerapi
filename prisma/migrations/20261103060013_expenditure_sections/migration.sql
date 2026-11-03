-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "billId" TEXT,
    "billVersion" INTEGER,
    "billFormat" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_projectId_date_idx" ON "Expense"("projectId", "date");

-- CreateIndex
CREATE INDEX "Expense_projectId_category_date_idx" ON "Expense"("projectId", "category", "date");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
