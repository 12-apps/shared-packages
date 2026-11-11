-- @domains: marketplace
-- @12-apps/marketplace: the engine's four tables, owned by the package and
-- copied into a host's migrations folder by its plugin-migration sync. Runs
-- identically on PostgreSQL and PGlite.
--
-- ── REPLAY-SAFE ON PURPOSE ────────────────────────────────────────────────
-- The first host to adopt this package already HAS these tables, created by
-- the private package this engine was extracted from. So every statement is
-- idempotent and this migration ADOPTS what exists instead of demanding a
-- baseline:
--
--   * a fresh host gets the four tables, every index and every CHECK;
--   * a host that already has them gets only what it is missing — the
--     outbound columns (`confirmed_at`, `confirm_failed_at`,
--     `cancellation_status`, `cancellation_reason_code`,
--     `cancellation_offending_skus`, `cancellation_requested_at`,
--     `preparation_minutes`), the order's `line_skus`, `delivered_by`, the
--     connection's `archived_at`, and the provider SHAPE check;
--   * replaying the whole folder is a no-op.
--
-- ── NO FOREIGN KEYS INTO HOST TABLES ──────────────────────────────────────
-- `client_id`, `order_id` and `menu_item_id` are by-value scalars: this
-- package cannot know what a host calls its tenant, order or catalog tables.
-- A host that wants the constraints adds them in its own migration. A host
-- that already has them keeps them: nothing here drops a foreign key.
--
-- ── THE PROVIDER IS AN ADAPTER'S ID, NOT A CLOSED LIST ────────────────────
-- A marketplace is an adapter registered at mount, so the column is checked
-- for the id's SHAPE (`^[A-Z][A-Z0-9_]*$`). The predecessor's closed-list
-- CHECKs (`*_provider_valid`) are dropped where they exist, because they would
-- refuse the first row of every new adapter.

-- ─────────────────────────────────────────────────────────────────────────────
-- marketplace_integrations — one store's connection to one marketplace.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketplace_integrations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "credentials" TEXT NOT NULL,
    "external_merchant_id" TEXT,
    "auto_accept" BOOLEAN NOT NULL DEFAULT false,
    "ack_sla_seconds" INTEGER NOT NULL DEFAULT 300,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "last_event_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_integrations_pkey" PRIMARY KEY ("id")
);

-- A connection is archived, never deleted (reversible; the host audits both).
ALTER TABLE "marketplace_integrations" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_integrations_client_id_provider_key"
    ON "marketplace_integrations"("client_id", "provider");
CREATE INDEX IF NOT EXISTS "marketplace_integrations_provider_external_merchant_id_idx"
    ON "marketplace_integrations"("provider", "external_merchant_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- marketplace_menu_links — a marketplace SKU and the host catalog id it means.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketplace_menu_links" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_sku" TEXT NOT NULL,
    "external_name" TEXT,
    "menu_item_id" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_menu_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_menu_links_client_id_provider_external_sku_key"
    ON "marketplace_menu_links"("client_id", "provider", "external_sku");
CREATE INDEX IF NOT EXISTS "marketplace_menu_links_client_id_provider_menu_item_id_idx"
    ON "marketplace_menu_links"("client_id", "provider", "menu_item_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- marketplace_inbox_events — one inbound delivery, exactly as it arrived.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketplace_inbox_events" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_order_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "marketplace_inbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_inbox_events_provider_event_id_key"
    ON "marketplace_inbox_events"("provider", "event_id");
CREATE INDEX IF NOT EXISTS "marketplace_inbox_events_status_received_at_idx"
    ON "marketplace_inbox_events"("status", "received_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- marketplace_acceptances — the acceptance clock and the outbound stamps.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketplace_acceptances" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "external_display_id" TEXT,
    "delivered_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING',
    "acknowledge_by" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "external_due_at" TIMESTAMP(3),
    "commission_cents" INTEGER,
    "confirmed_at" TIMESTAMP(3),
    "confirm_failed_at" TIMESTAMP(3),
    "cancellation_status" TEXT,
    "cancellation_reason_code" TEXT,
    "cancellation_offending_skus" JSONB,
    "cancellation_requested_at" TIMESTAMP(3),
    "preparation_minutes" INTEGER,
    "line_skus" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_acceptances_pkey" PRIMARY KEY ("id")
);

-- What a host whose table predates them is missing.
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "delivered_by" TEXT;
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMP(3);
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "confirm_failed_at" TIMESTAMP(3);
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "cancellation_status" TEXT;
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "cancellation_reason_code" TEXT;
-- The SKUs a cancellation names, for a marketplace whose reason needs them.
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "cancellation_offending_skus" JSONB;
-- When the request was stamped PENDING: what the outbound sweep ages it by.
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "cancellation_requested_at" TIMESTAMP(3);
-- The preparation time an accept states, for a marketplace whose confirm takes one.
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "preparation_minutes" INTEGER;
-- The order's SKUs as the marketplace sent them: what offending SKUs are checked against.
ALTER TABLE "marketplace_acceptances" ADD COLUMN IF NOT EXISTS "line_skus" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_acceptances_order_id_key"
    ON "marketplace_acceptances"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_acceptances_provider_external_order_id_key"
    ON "marketplace_acceptances"("provider", "external_order_id");
CREATE INDEX IF NOT EXISTS "marketplace_acceptances_client_id_status_idx"
    ON "marketplace_acceptances"("client_id", "status");
-- The outbound sweep reads only rows whose request is still owed.
CREATE INDEX IF NOT EXISTS "marketplace_acceptances_cancellation_requested_at_idx"
    ON "marketplace_acceptances"("cancellation_requested_at")
    WHERE "cancellation_status" = 'PENDING';
-- The sweep reads only rows still on the clock.
CREATE INDEX IF NOT EXISTS "marketplace_acceptances_acknowledge_by_idx"
    ON "marketplace_acceptances"("acknowledge_by")
    WHERE "status" = 'AWAITING';

-- ─────────────────────────────────────────────────────────────────────────────
-- The provider: an adapter's id, checked for shape. The closed lists go.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "marketplace_integrations" DROP CONSTRAINT IF EXISTS "marketplace_integrations_provider_valid";
ALTER TABLE "marketplace_menu_links" DROP CONSTRAINT IF EXISTS "marketplace_menu_links_provider_valid";
ALTER TABLE "marketplace_inbox_events" DROP CONSTRAINT IF EXISTS "marketplace_inbox_events_provider_valid";
ALTER TABLE "marketplace_acceptances" DROP CONSTRAINT IF EXISTS "marketplace_acceptances_provider_valid";

DO $$ BEGIN
    ALTER TABLE "marketplace_integrations" ADD CONSTRAINT "marketplace_integrations_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_menu_links" ADD CONSTRAINT "marketplace_menu_links_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_inbox_events" ADD CONSTRAINT "marketplace_inbox_events_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The closed sets the engine writes. Same names as the predecessor's, so a
-- host that has them skips them.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "marketplace_integrations" ADD CONSTRAINT "marketplace_integrations_environment_valid"
        CHECK ("environment" IN ('SANDBOX', 'PRODUCTION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_integrations" ADD CONSTRAINT "marketplace_integrations_status_valid"
        CHECK ("status" IN ('UNVERIFIED', 'VERIFIED', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_integrations" ADD CONSTRAINT "marketplace_integrations_ack_sla_positive"
        CHECK ("ack_sla_seconds" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_inbox_events" ADD CONSTRAINT "marketplace_inbox_events_status_valid"
        CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_status_valid"
        CHECK ("status" IN ('AWAITING', 'ACCEPTED', 'REJECTED', 'EXPIRED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_commission_valid"
        CHECK ("commission_cents" IS NULL OR "commission_cents" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Off the clock means acknowledged, and on it means not yet.
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_timestamps_valid"
        CHECK (
          ("status" = 'AWAITING' AND "acknowledged_at" IS NULL)
          OR ("status" <> 'AWAITING' AND "acknowledged_at" IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_delivered_by_valid"
        CHECK ("delivered_by" IS NULL OR "delivered_by" IN ('MERCHANT', 'MARKETPLACE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- The store's cancellation request. NULL when the store never asked.
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_cancellation_status_check"
        CHECK ("cancellation_status" IS NULL
               OR "cancellation_status" IN ('PENDING', 'REQUESTED', 'CONFIRMED', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "marketplace_acceptances" ADD CONSTRAINT "marketplace_acceptances_preparation_minutes_valid"
        CHECK ("preparation_minutes" IS NULL OR "preparation_minutes" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
