-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FindingSource" ADD VALUE 'GIST';
ALTER TYPE "FindingSource" ADD VALUE 'PASTEBIN';

-- CreateTable
CREATE TABLE "feed_states" (
    "source" "FindingSource" NOT NULL,
    "cursor" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_read" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "feed_states_pkey" PRIMARY KEY ("source")
);
