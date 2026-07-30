-- CreateTable
CREATE TABLE "Application" (
    "id" SERIAL NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Applied',

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);
