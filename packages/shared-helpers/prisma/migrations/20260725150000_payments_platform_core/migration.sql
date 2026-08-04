-- @12-apps/payments-backend owned migration: the three self-contained payment
-- tables (provider configs, charges, webhook inbox). No FK into host tables —
-- merchant scope is (merchant_kind, merchant_id). Copy this file into the
-- host's prisma/migrations folder (keep the timestamp ordering) after running
-- `prisma:sync`; CHECK constraints carry the String-over-enum closed sets.

CREATE TABLE "payment_provider_configs" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "last_verified_at" TIMESTAMP(3),
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_provider_configs_merchant_kind_check"
        CHECK ("merchant_kind" IN ('PLATFORM', 'TENANT')),
    CONSTRAINT "payment_provider_configs_environment_check"
        CHECK ("environment" IN ('SANDBOX', 'PRODUCTION')),
    CONSTRAINT "payment_provider_configs_status_check"
        CHECK ("status" IN ('UNVERIFIED', 'VERIFIED', 'FAILED'))
);

CREATE UNIQUE INDEX "payment_provider_configs_merchant_kind_merchant_id_provider_key"
    ON "payment_provider_configs"("merchant_kind", "merchant_id", "provider");
CREATE INDEX "payment_provider_configs_merchant_kind_merchant_id_idx"
    ON "payment_provider_configs"("merchant_kind", "merchant_id");
-- SINGLE ACTIVE PROVIDER, enforced by the database rather than by app code:
-- at most one enabled config per merchant. A racing "enable" now fails loudly
-- on this constraint instead of silently leaving two providers enabled (which
-- would make charge routing depend on row order). Partial indexes are not
-- expressible in the Prisma schema — same migration-only pattern the repo
-- already uses for its CHECK constraints.
CREATE UNIQUE INDEX "payment_provider_configs_one_enabled_per_merchant"
    ON "payment_provider_configs"("merchant_kind", "merchant_id") WHERE "enabled";

CREATE TABLE "payment_charges" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_charges_merchant_kind_check"
        CHECK ("merchant_kind" IN ('PLATFORM', 'TENANT')),
    CONSTRAINT "payment_charges_status_check"
        CHECK ("status" IN ('PENDING', 'AUTHORIZED', 'PAID', 'DECLINED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
    CONSTRAINT "payment_charges_method_check"
        CHECK ("method" IN ('PIX', 'CARD', 'BOLETO'))
);

CREATE UNIQUE INDEX "payment_charges_provider_provider_charge_id_key"
    ON "payment_charges"("provider", "provider_charge_id");
CREATE UNIQUE INDEX "payment_charges_merchant_kind_merchant_id_idempotency_key_key"
    ON "payment_charges"("merchant_kind", "merchant_id", "idempotency_key");
CREATE INDEX "payment_charges_merchant_kind_merchant_id_created_at_idx"
    ON "payment_charges"("merchant_kind", "merchant_id", "created_at");
CREATE INDEX "payment_charges_reference_idx" ON "payment_charges"("reference");

CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "merchant_kind" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "headers" TEXT,
    "payload" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_webhook_events_status_check"
        CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED'))
);

CREATE UNIQUE INDEX "payment_webhook_events_merchant_provider_event_key"
    ON "payment_webhook_events"("merchant_kind", "merchant_id", "provider", "event_id");
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events"("status");
