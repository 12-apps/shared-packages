-- @12-apps/payments-backend owned migration: OAuth connection support.
--
-- `expires_at` is a first-class column rather than another key inside the
-- encrypted `credentials` blob, precisely so it is QUERYABLE: a background
-- job asks "which connections expire in the next hour" and refreshes them.
-- Nothing inside the ciphertext can be indexed or compared in SQL.
--
-- The status CHECK is widened with RECONNECT_REQUIRED, which is deliberately
-- distinct from FAILED: the remedy is reauthorizing (a button), not fixing
-- credentials (a form).

ALTER TABLE "payment_provider_configs"
    ADD COLUMN "expires_at" TIMESTAMP(3);

ALTER TABLE "payment_provider_configs"
    DROP CONSTRAINT "payment_provider_configs_status_check";

ALTER TABLE "payment_provider_configs"
    ADD CONSTRAINT "payment_provider_configs_status_check"
        CHECK ("status" IN ('UNVERIFIED', 'VERIFIED', 'FAILED', 'RECONNECT_REQUIRED'));

-- Drives the refresh sweep: only connections that actually expire (OAuth)
-- have a non-null value, so this index stays small.
CREATE INDEX "payment_provider_configs_expires_at_idx"
    ON "payment_provider_configs"("expires_at") WHERE "expires_at" IS NOT NULL;
