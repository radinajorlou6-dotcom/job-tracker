/*
  Warnings:

  - You are about to drop the column `companyName` on the `Listing` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Listing` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "source" TEXT,
ALTER COLUMN "company" DROP NOT NULL,
ALTER COLUMN "role" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "companyName",
DROP COLUMN "title",
ADD COLUMN     "company" TEXT,
ADD COLUMN     "role" TEXT;
