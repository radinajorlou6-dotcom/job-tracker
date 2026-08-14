-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "category" TEXT,
ADD COLUMN     "companyUrl" TEXT,
ADD COLUMN     "dateApplied" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "datePosted" TIMESTAMP(3),
ADD COLUMN     "degrees" TEXT[],
ADD COLUMN     "locations" TEXT[],
ADD COLUMN     "salary" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sponsorship" TEXT,
ADD COLUMN     "terms" TEXT[],
ADD COLUMN     "url" TEXT;

-- CreateTable
CREATE TABLE "Listing" (
    "id" SERIAL NOT NULL,
    "source" TEXT,
    "category" TEXT,
    "companyName" TEXT,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "active" BOOLEAN,
    "terms" TEXT[],
    "dateUpdated" TIMESTAMP(3),
    "datePosted" TIMESTAMP(3),
    "url" TEXT,
    "locations" TEXT[],
    "companyUrl" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sponsorship" TEXT,
    "degrees" TEXT[],

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Listing_sourceId_key" ON "Listing"("sourceId");
