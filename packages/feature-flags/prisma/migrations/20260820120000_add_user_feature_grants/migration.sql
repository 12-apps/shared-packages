-- CreateTable
CREATE TABLE "user_feature_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "granted_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_feature_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_feature_grants_user_id_flag_key_key" ON "user_feature_grants"("user_id", "flag_key");

-- CreateIndex
CREATE INDEX "user_feature_grants_flag_key_idx" ON "user_feature_grants"("flag_key");
