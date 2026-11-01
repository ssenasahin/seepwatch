-- CreateEnum
CREATE TYPE "FindingSource" AS ENUM ('GITHUB_COMMIT', 'GITHUB_CODE');

-- AlterTable
ALTER TABLE "watches" ADD COLUMN     "last_scan_at" TIMESTAMP(3),
ADD COLUMN     "last_scan_error" TEXT,
ADD COLUMN     "scan_cursor" TIMESTAMP(3),
ADD COLUMN     "verify_failures" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "watch_id" UUID,
    "detector" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "masked" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_locations" (
    "id" BIGSERIAL NOT NULL,
    "finding_id" UUID NOT NULL,
    "source" "FindingSource" NOT NULL,
    "url" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "commit_sha" TEXT,
    "line" INTEGER,
    "context" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3),
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "findings_owner_id_first_seen_at_idx" ON "findings"("owner_id", "first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "findings_owner_id_fingerprint_key" ON "findings"("owner_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "finding_locations_finding_id_url_key" ON "finding_locations"("finding_id", "url");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_locations" ADD CONSTRAINT "finding_locations_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

