-- FUT-105: OAuth 2.1 authorization-server persistence.
--
-- Two durable models behind the MCP OAuth flow (authorization codes stay
-- STATELESS — signed blobs, so there is deliberately NO oauth_codes table):
--   * oauth_clients        — a registered external host (Claude.ai / ChatGPT
--                            connector) from RFC 7591 dynamic client
--                            registration or static registration. NOT the
--                            multi-tenant `clients` table — namespaced to avoid
--                            that collision; no FK to users (clients are apps).
--   * oauth_refresh_tokens — a rotating refresh token bound to a user email +
--                            client, stored HASHED (SHA-256), rotated on use
--                            with `rotated_from` lineage and a `revoked_at`
--                            revoke path.
--
-- Additive and replay-safe: the PGlite file-db provisioner replays every
-- committed migration into an existing schema, so every statement is guarded
-- (`CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`) and the
-- CHECK constraint is installed via a conrelid-scoped DO block (`ADD CONSTRAINT`
-- has no IF NOT EXISTS form, and constraint names are only unique per table).

-- Registered OAuth client (host app). Array columns are Postgres TEXT[]:
-- redirect_uris is the exact-match allowlist for open-redirect prevention;
-- grant_types / scopes are the DCR metadata.
CREATE TABLE IF NOT EXISTS "oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "redirect_uris" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "client_name" TEXT,
    "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
    "grant_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- Public identifier a token/authorize request presents; unique across clients.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_clients_client_id_key"
  ON "oauth_clients"("client_id");

-- token_endpoint_auth_method domain guard (String+CHECK house style). Scoped to
-- conrelid because constraint names are unique only per table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oauth_clients_token_endpoint_auth_method_valid'
      AND conrelid = 'oauth_clients'::regclass
  ) THEN
    ALTER TABLE "oauth_clients"
      ADD CONSTRAINT "oauth_clients_token_endpoint_auth_method_valid"
      CHECK ("token_endpoint_auth_method" IN ('none', 'client_secret_basic'));
  END IF;
END $$;

-- Rotating refresh token. token_hash is the SHA-256 of the opaque token (never
-- plaintext); user_email is the bound identity (email per the identity rule);
-- client_id is a by-value link to oauth_clients.client_id; rotated_from carries
-- the prior token's hash for rotation lineage / replay detection; revoked_at is
-- the explicit revoke path.
CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_from" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Lookup-on-presentation: hash the incoming token, find its row. Unique so a
-- hash collision / duplicate insert is a DB-level error, not silent.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_refresh_tokens_token_hash_key"
  ON "oauth_refresh_tokens"("token_hash");

-- Per-user/per-client enumeration + bulk revoke (e.g. revoke every token for a
-- user's client on lineage-replay detection).
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_user_email_client_id_idx"
  ON "oauth_refresh_tokens"("user_email", "client_id");
