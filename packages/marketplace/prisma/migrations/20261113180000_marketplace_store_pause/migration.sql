-- @domains: marketplace
-- @12-apps/marketplace: a store's pause on each marketplace (FUT-4851).
-- Additive and replay-safe, like the engine's earlier migrations: one new
-- table, its CHECKs and indexes. No foreign key into a host table.
--
-- One row per (store, marketplace). `wanted` is the host's last ask (PAUSED
-- or OPEN); `state` is where the marketplace stands (OPEN, PAUSING, PAUSED,
-- RESUMING, FAILED). The engine deletes on a marketplace only what a row
-- records: `external_id`, `retired_external_ids` (space-separated), or a
-- closure created under `attempt_key` (recognised by `attempt_until`).

CREATE TABLE IF NOT EXISTS "marketplace_store_pauses" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "wanted" TEXT NOT NULL DEFAULT 'OPEN',
    "until" TIMESTAMP(3),
    "reason" TEXT,
    "time_zone" TEXT,
    "external_id" TEXT,
    "sent_until" TIMESTAMP(3),
    "attempt_key" TEXT,
    "attempt_until" TIMESTAMP(3),
    "retired_external_ids" TEXT,
    "failure_code" TEXT,
    "failure_detail" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_store_pauses_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "marketplace_store_pauses" ADD CONSTRAINT "marketplace_store_pauses_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_store_pauses" ADD CONSTRAINT "marketplace_store_pauses_state_check"
        CHECK ("state" IN ('OPEN', 'PAUSING', 'PAUSED', 'RESUMING', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_store_pauses" ADD CONSTRAINT "marketplace_store_pauses_wanted_check"
        CHECK ("wanted" IN ('PAUSED', 'OPEN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_store_pauses" ADD CONSTRAINT "marketplace_store_pauses_failure_code_check"
        CHECK ("failure_code" IS NULL OR "failure_code" IN (
            'UNSUPPORTED', 'NOT_CONNECTED', 'PAUSE_REFUSED', 'PAUSE_UNANSWERED', 'RESUME_REFUSED', 'RESUME_UNANSWERED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One pause per store and marketplace: the upsert's key.
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_store_pauses_client_id_provider_key"
    ON "marketplace_store_pauses"("client_id", "provider");

-- The sweep: asks still owed, by age.
CREATE INDEX IF NOT EXISTS "marketplace_store_pauses_state_requested_at_idx"
    ON "marketplace_store_pauses"("state", "requested_at");

-- The sweep: pauses past their end.
CREATE INDEX IF NOT EXISTS "marketplace_store_pauses_wanted_until_idx"
    ON "marketplace_store_pauses"("wanted", "until");
