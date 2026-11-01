-- CreateEnum
CREATE TYPE "WatchKind" AS ENUM ('DOMAIN', 'EMAIL', 'GITHUB_ORG', 'KEY_PATTERN');

-- CreateEnum
CREATE TYPE "KeyCharset" AS ENUM ('ALNUM', 'HEX', 'BASE64URL');

-- CreateTable
CREATE TABLE "watches" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "WatchKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "domain_watch_id" UUID,
    "key_charset" "KeyCharset",
    "key_min_length" INTEGER,
    "key_max_length" INTEGER,
    "verify_token" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_verify_at" TIMESTAMP(3),
    "last_verify_error" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "escalation_policy_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watches_domain_watch_id_idx" ON "watches"("domain_watch_id");

-- CreateIndex
CREATE UNIQUE INDEX "watches_owner_id_kind_value_key" ON "watches"("owner_id", "kind", "value");

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_domain_watch_id_fkey" FOREIGN KEY ("domain_watch_id") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_escalation_policy_id_fkey" FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A key pattern always has its whole shape, and nothing else has one.
ALTER TABLE "watches" ADD CONSTRAINT "watches_key_pattern_shape" CHECK (
  ("kind" = 'KEY_PATTERN') = (
    "key_charset" IS NOT NULL AND "key_min_length" IS NOT NULL AND "key_max_length" IS NOT NULL
    AND "key_min_length" <= "key_max_length"
  )
);

-- Every address belongs to a domain watch, and only addresses do.
ALTER TABLE "watches" ADD CONSTRAINT "watches_email_has_domain" CHECK (
  ("kind" = 'EMAIL') = ("domain_watch_id" IS NOT NULL)
);
