-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "marketValue" DECIMAL(14,2),
ADD COLUMN     "marketValueOn" DATE,
ADD COLUMN     "unitCost" DECIMAL(14,2);
