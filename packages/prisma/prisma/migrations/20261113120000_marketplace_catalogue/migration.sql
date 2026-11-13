-- @domains: marketplace
-- @12-apps/marketplace: the catalogue publication (FUT-4768). Additive and
-- replay-safe, like the engine's other migrations: two new tables, their
-- indexes and their CHECKs. No column of an existing table changes.
--
-- One row per (store, marketplace, host product): whether the store wants the
-- product in that marketplace's catalogue, the price it set for that
-- marketplace (NULL: the store's own), and what the marketplace made of it.
-- `product_id` is a by-value scalar, like `menu_item_id`: no foreign key into
-- a host table.

CREATE TABLE IF NOT EXISTS "marketplace_catalogue_publications" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHING',
    "price_cents" INTEGER,
    "sent_price_cents" INTEGER,
    "external_id" TEXT,
    "failed_action" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_catalogue_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_catalogue_publications_client_provider_product_key"
    ON "marketplace_catalogue_publications"("client_id", "provider", "product_id");
CREATE INDEX IF NOT EXISTS "marketplace_catalogue_publications_client_id_product_id_idx"
    ON "marketplace_catalogue_publications"("client_id", "product_id");
CREATE INDEX IF NOT EXISTS "marketplace_catalogue_publications_status_requested_at_idx"
    ON "marketplace_catalogue_publications"("status", "requested_at");

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_publications" ADD CONSTRAINT "marketplace_catalogue_publications_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_publications" ADD CONSTRAINT "marketplace_catalogue_publications_status_check"
        CHECK ("status" IN ('PUBLISHING', 'PUBLISHED', 'WITHDRAWING', 'WITHDRAWN', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_publications" ADD CONSTRAINT "marketplace_catalogue_publications_failed_action_check"
        CHECK ("failed_action" IS NULL OR "failed_action" IN ('PUBLISH', 'WITHDRAW'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_publications" ADD CONSTRAINT "marketplace_catalogue_publications_failure_code_check"
        CHECK ("failure_code" IS NULL OR "failure_code" IN ('REFUSED', 'UNAVAILABLE', 'TIMEOUT', 'NOT_CONNECTED',
                                                            'CREDENTIALS', 'PRODUCT_GONE', 'UNSUPPORTED', 'INTERNAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_publications" ADD CONSTRAINT "marketplace_catalogue_publications_price_check"
        CHECK (("price_cents" IS NULL OR "price_cents" > 0)
               AND ("sent_price_cents" IS NULL OR "sent_price_cents" > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The marketplace's id for one host category on one connection, found or
-- created by name once and reused; claimed while it is being created.
CREATE TABLE IF NOT EXISTS "marketplace_catalogue_categories" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_catalogue_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_catalogue_categories_client_id_provider_name_key"
    ON "marketplace_catalogue_categories"("client_id", "provider", "name");

DO $$ BEGIN
    ALTER TABLE "marketplace_catalogue_categories" ADD CONSTRAINT "marketplace_catalogue_categories_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
