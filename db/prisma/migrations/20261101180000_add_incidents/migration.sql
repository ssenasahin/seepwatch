-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'REVOKED', 'FALSE_POSITIVE', 'RISK_ACCEPTED');

-- CreateEnum
CREATE TYPE "IncidentEventType" AS ENUM ('OPENED', 'NOTIFIED', 'NOT_DELIVERED', 'ESCALATED', 'REMINDED', 'ACKNOWLEDGED', 'SEEN_AGAIN', 'REVOKED', 'FALSE_POSITIVE', 'RISK_ACCEPTED');

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "close_reason" TEXT,
    "round" INTEGER NOT NULL DEFAULT 0,
    "next_alert_at" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" BIGSERIAL NOT NULL,
    "incident_id" UUID NOT NULL,
    "type" "IncidentEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_finding_id_key" ON "incidents"("finding_id");

-- CreateIndex
CREATE INDEX "incidents_next_alert_at_idx" ON "incidents"("next_alert_at");

-- CreateIndex
CREATE INDEX "incidents_owner_id_opened_at_idx" ON "incidents"("owner_id", "opened_at");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_at_idx" ON "incident_events"("incident_id", "at");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closing a leak without revoking the secret needs a reason someone can read later.
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_close_reason" CHECK (
  "status" NOT IN ('FALSE_POSITIVE', 'RISK_ACCEPTED')
  OR length(trim(coalesce("close_reason", ''))) > 0
);
