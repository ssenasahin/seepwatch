-- CreateTable
CREATE TABLE "pending_signups" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_signups_email_key" ON "pending_signups"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pending_signups_token_hash_key" ON "pending_signups"("token_hash");

-- CreateIndex
CREATE INDEX "pending_signups_expires_at_idx" ON "pending_signups"("expires_at");
