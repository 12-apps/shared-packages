-- @domains: marketplace
-- @12-apps/marketplace: why a store's cancellation request FAILED (FUT-4758).
-- Additive and replay-safe, like the engine's first migration: one nullable
-- column, its CHECK, and an index for the expiry of requests still waiting.
--
-- `cancellation_failure_reason` is REFUSED (the marketplace said no, or every
-- attempt failed) or TIMEOUT (no answer inside the marketplace's window). NULL
-- whenever `cancellation_status` is not FAILED, and on rows from before it.

ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "cancellation_failure_reason" TEXT;

DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_cancellation_failure_reason_check"
        CHECK ("cancellation_failure_reason" IS NULL
               OR "cancellation_failure_reason" IN ('REFUSED', 'TIMEOUT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The expiry reads only requests still waiting on the marketplace.
CREATE INDEX IF NOT EXISTS "marketplace_acceptances_cancellation_waiting_idx"
    ON "marketplace_acceptances"("cancellation_requested_at")
    WHERE "cancellation_status" IN ('PENDING', 'REQUESTED');
