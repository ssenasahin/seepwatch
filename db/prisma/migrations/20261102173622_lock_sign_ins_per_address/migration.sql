-- CreateTable
CREATE TABLE "sign_in_throttles" (
    "user_id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sign_in_throttles_pkey" PRIMARY KEY ("user_id","ip")
);

-- CreateIndex
CREATE INDEX "sign_in_throttles_updated_at_idx" ON "sign_in_throttles"("updated_at");

-- AddForeignKey
ALTER TABLE "sign_in_throttles" ADD CONSTRAINT "sign_in_throttles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
