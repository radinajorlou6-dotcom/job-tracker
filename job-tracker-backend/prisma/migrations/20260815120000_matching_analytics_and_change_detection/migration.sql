-- DropIndex
DROP INDEX "Listing_sourceId_key";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dismissedHash" TEXT,
ADD COLUMN     "listingId" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "snapshotHash" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "feed" TEXT NOT NULL DEFAULT 'summer2027',
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastChangedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "desiredRoles" TEXT[],
    "preferredLocations" TEXT[],
    "remotePreference" TEXT NOT NULL DEFAULT 'any',
    "terms" TEXT[],
    "degrees" TEXT[],
    "categories" TEXT[],
    "needsSponsorship" BOOLEAN NOT NULL DEFAULT false,
    "excludedCompanies" TEXT[],
    "mustHaves" TEXT,
    "dealBreakers" TEXT,
    "values" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ListingMatch" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "verdict" TEXT,
    "reasons" TEXT[],
    "concerns" TEXT[],
    "summary" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'heuristic',
    "model" TEXT,
    "prefsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationEvent_userId_createdAt_idx" ON "ApplicationEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_idx" ON "ApplicationEvent"("applicationId");

-- CreateIndex
CREATE INDEX "ListingMatch_userId_score_idx" ON "ListingMatch"("userId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ListingMatch_userId_listingId_key" ON "ListingMatch"("userId", "listingId");

-- CreateIndex
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");

-- CreateIndex
CREATE INDEX "Application_userId_dateApplied_idx" ON "Application"("userId", "dateApplied");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_listingId_key" ON "Application"("userId", "listingId");

-- CreateIndex
CREATE INDEX "Listing_datePosted_idx" ON "Listing"("datePosted");

-- CreateIndex
CREATE INDEX "Listing_active_isVisible_idx" ON "Listing"("active", "isVisible");

-- CreateIndex
CREATE INDEX "Listing_company_idx" ON "Listing"("company");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_feed_sourceId_key" ON "Listing"("feed", "sourceId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMatch" ADD CONSTRAINT "ListingMatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

