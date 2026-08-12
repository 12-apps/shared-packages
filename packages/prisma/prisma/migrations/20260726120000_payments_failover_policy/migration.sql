-- @12-apps/payments-backend owned migration: merchant-level failover policy.
--
-- FUT-303 shipped `failoverPolicy` as a construction-time gateway option, which
-- meant a merchant could not actually choose it — the ticket asks for a policy,
-- and a constant no store owner can reach is not one. This gives it a home.
--
-- It is merchant-level rather than per-provider on purpose: "may a decline
-- cascade to the next acquirer" is a decision about the CHAIN, and hanging it
-- off each provider row would let one merchant hold two contradictory answers.

CREATE TABLE "payment_merchant_settings" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    -- TECHNICAL is the default everywhere, including for merchants who never
    -- get a row: cascading a declined card is opt-in, never inherited.
    "failover_policy" TEXT NOT NULL DEFAULT 'TECHNICAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_merchant_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_merchant_settings_merchant_kind_check"
        CHECK ("merchant_kind" IN ('PLATFORM', 'TENANT')),
    CONSTRAINT "payment_merchant_settings_failover_policy_check"
        CHECK ("failover_policy" IN ('TECHNICAL', 'TECHNICAL_AND_DECLINE'))
);

CREATE UNIQUE INDEX "payment_merchant_settings_merchant_key"
    ON "payment_merchant_settings"("merchant_kind", "merchant_id");
