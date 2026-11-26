-- @domains: marketplace
-- @12-apps/marketplace: linking a store through the software's own app (FUT-5613).
-- Additive and replay-safe, like the engine's earlier migrations: one new
-- column with a default, one new table with its CHECKs and its unique, and one
-- partial unique index. No foreign key into a host table, and nothing the
-- previous release reads is changed.
--
-- `auth_mode` says how a connection authenticates: CREDENTIALS (the store's
-- own app, every existing row) or LINKED (the store authorized the software's
-- app; the sealed `credentials` blob holds its refresh token).
--
-- `marketplace_link_attempts` holds one linking in progress per (store,
-- marketplace): the portal code shown to the person and the sealed verifier
-- the exchange needs, removed by the exchange that uses it.

ALTER TABLE "marketplace_integrations" ADD COLUMN IF NOT EXISTS "auth_mode" TEXT NOT NULL DEFAULT 'CREDENTIALS';

DO $$ BEGIN
    ALTER TABLE "marketplace_integrations" ADD CONSTRAINT "marketplace_integrations_auth_mode_check"
        CHECK ("auth_mode" IN ('CREDENTIALS', 'LINKED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "marketplace_link_attempts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "verifier" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "verification_url" TEXT NOT NULL,
    "verification_url_complete" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_link_attempts_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "marketplace_link_attempts" ADD CONSTRAINT "marketplace_link_attempts_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_link_attempts" ADD CONSTRAINT "marketplace_link_attempts_environment_check"
        CHECK ("environment" IN ('SANDBOX', 'PRODUCTION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One linking in progress per store and marketplace: starting again replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_link_attempts_client_id_provider_key"
    ON "marketplace_link_attempts"("client_id", "provider");

-- One live connection per marketplace store: the app's single webhook address
-- routes a delivery by the merchant id it names, so two live rows holding one
-- merchant would hand one store's orders to another. Archived rows and rows
-- with no merchant yet are outside the index.
--
-- Until this release nothing refused a merchant id another store held, so a
-- host may already have such pairs. The index is then NOT created, and no row
-- is rewritten or archived: which store a marketplace store really is, is the
-- host's call. The engine still refuses every new duplicate and attributes an
-- ambiguous merchant to nobody; a later migration adds the index once the host
-- has resolved them (the WARNING names how many).
DO $$
DECLARE
    duplicates integer;
BEGIN
    SELECT count(*) INTO duplicates FROM (
        SELECT 1 FROM "marketplace_integrations"
        WHERE "archived_at" IS NULL AND "external_merchant_id" IS NOT NULL
        GROUP BY "provider", "external_merchant_id"
        HAVING count(*) > 1
    ) AS held_twice;
    IF duplicates > 0 THEN
        RAISE WARNING 'marketplace_integrations_live_merchant_key not created: % merchant id(s) are held by more than one live connection', duplicates;
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_integrations_live_merchant_key"
            ON "marketplace_integrations"("provider", "external_merchant_id")
            WHERE "archived_at" IS NULL AND "external_merchant_id" IS NOT NULL;
    END IF;
END $$;
