-- @12-apps/payments-backend owned migration: priority list + failover ledger.
--
-- This retires the SINGLE ACTIVE PROVIDER invariant. Until now the database
-- itself guaranteed at most one enabled config per merchant; a merchant may
-- now enable several and RANK them, and checkout walks that ranking when a
-- provider fails. The guarantee is not dropped so much as replaced: ranks
-- among a merchant's enabled rows must stay DISTINCT, or routing order would
-- again depend on row order — exactly the ambiguity the old index existed to
-- prevent.

ALTER TABLE "payment_provider_configs"
    ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- Backfill is a no-op by construction: the index being dropped below allowed
-- at most ONE enabled row per merchant, so every pre-existing chain has
-- exactly one member and rank 0 is already correct for it. Disabled rows also
-- carry 0, which the partial index below simply ignores.

DROP INDEX "payment_provider_configs_one_enabled_per_merchant";

-- The replacement invariant: two ENABLED providers can never share a rank, so
-- a merchant's chain is a total order. A racing reorder fails loudly here
-- rather than silently producing a chain whose order depends on which row the
-- planner returned first.
CREATE UNIQUE INDEX "payment_provider_configs_enabled_priority_key"
    ON "payment_provider_configs"("merchant_kind", "merchant_id", "priority")
    WHERE "enabled";

-- One row per ATTEMPT in a failover walk. This is the evidence trail for the
-- proof-of-failure rule: it records not just that a provider failed but which
-- BUCKET the failure fell into and, when the outcome was ambiguous, what the
-- reconciliation probe concluded. A double charge and a stranded charge look
-- identical in provider dashboards; they do not look identical here.
CREATE TABLE "payment_charge_attempts" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "failure_bucket" TEXT,
    "probe_result" TEXT,
    "provider_charge_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_charge_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_charge_attempts_merchant_kind_check"
        CHECK ("merchant_kind" IN ('PLATFORM', 'TENANT')),
    CONSTRAINT "payment_charge_attempts_outcome_check"
        CHECK ("outcome" IN ('SUCCEEDED', 'ADOPTED', 'FAILED_OVER', 'STOPPED', 'DECLINED', 'SKIPPED')),
    CONSTRAINT "payment_charge_attempts_failure_bucket_check"
        CHECK ("failure_bucket" IS NULL OR "failure_bucket" IN ('DEFINITELY_NOT_CHARGED', 'AMBIGUOUS', 'BUSINESS_OUTCOME')),
    CONSTRAINT "payment_charge_attempts_probe_result_check"
        CHECK ("probe_result" IS NULL OR "probe_result" IN ('NOT_CHARGED', 'CHARGE_FOUND', 'PROBE_FAILED', 'UNSUPPORTED'))
);

-- Resume lookup: "what has this idempotency key already tried?" — so a
-- retried charge continues the walk instead of restarting it.
CREATE INDEX "payment_charge_attempts_merchant_idempotency_key_idx"
    ON "payment_charge_attempts"("merchant_kind", "merchant_id", "idempotency_key");
CREATE INDEX "payment_charge_attempts_reference_idx"
    ON "payment_charge_attempts"("reference");
CREATE INDEX "payment_charge_attempts_merchant_created_at_idx"
    ON "payment_charge_attempts"("merchant_kind", "merchant_id", "created_at");
