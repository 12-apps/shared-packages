-- @12-apps/payments-backend owned migration: a store refund's retry series
-- (FUT-4740).
--
-- A refund PagBank answers "not yet" (40008), or does not answer at all, is
-- retried in the background: 3 attempts for a "not yet", 4 for no answer,
-- each claimed behind `version`, so a sweep, a second process and a person's
-- press never send two cancels for one attempt. The sweep's idle tick is one
-- query on the partial index below.
--
-- Additive only: a new table, its checks and indexes. A release that does not
-- know it never reads it; a rollback leaves an unread table.

CREATE TABLE "payment_refund_retries" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bound_to" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "cause" TEXT,
    "series" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "attempts" INTEGER,
    "next_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "refusal" TEXT,
    "reported" BOOLEAN NOT NULL DEFAULT false,
    "settled_at" TIMESTAMP(3),
    "settled_how" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_refund_retries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_refund_retries_refusal_check" CHECK ("refusal" IS NULL OR "refusal" IN ('NOT_YET', 'REFUSED', 'UNKNOWN')),
    CONSTRAINT "payment_refund_retries_settled_how_check" CHECK ("settled_how" IS NULL OR "settled_how" IN ('REFUNDED', 'ADOPTED', 'BY_HAND', 'ENDED')),
    CONSTRAINT "payment_refund_retries_attempts_check" CHECK ("attempts" IS NULL OR "attempts" IN (3, 4))
);

CREATE UNIQUE INDEX "payment_refund_retries_provider_provider_charge_id_subject_key"
    ON "payment_refund_retries"("provider", "provider_charge_id", "subject");

CREATE INDEX "payment_refund_retries_merchant_kind_merchant_id_reference_idx"
    ON "payment_refund_retries"("merchant_kind", "merchant_id", "reference");

-- The sweep's "what is due": only live series are in it.
CREATE INDEX "payment_refund_retries_due_idx"
    ON "payment_refund_retries"("next_at")
    WHERE "settled_at" IS NULL AND "exhausted" = false;
