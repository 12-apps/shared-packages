-- @domains: marketplace
-- @12-apps/marketplace: linking a store through the software's own app (FUT-5613).
-- Additive and replay-safe, like the engine's earlier migrations: one new
-- column with a default, one new table with its CHECKs and its unique. No
-- foreign key into a host table, and nothing the previous release reads is
-- changed.
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
