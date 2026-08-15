-- @12-apps/mcp (12-23): the three tables behind an MCP surface's OAuth 2.1
-- authorization server, owned by the package and copied into a host's migrations
-- folder by its plugin-migration sync.
--
--   * oauth_clients        — a registered external host (a Claude.ai / ChatGPT
--                            connector) from RFC 7591 dynamic client
--                            registration or a static registration. NOT a
--                            multi-tenant customer table — namespaced to avoid
--                            that collision; no FK to users (clients are apps).
--   * oauth_refresh_tokens — a rotating refresh token bound to a user email +
--                            client, stored HASHED (SHA-256), rotated on use
--                            with `rotated_from` lineage and a `revoked_at`
--                            revoke path.
--   * mcp_connections      — which AI host a user has connected, and how
--                            recently it was active. Per-USER, because an MCP
--                            bearer is auth-passthrough and not tenant-scoped.
--
-- Authorization codes are deliberately absent: they are STATELESS signed blobs,
-- so there is no table to create and nothing to sweep.
--
-- The columns, defaults, indexes and CHECK are the origin host's
-- `20260713120000_add_oauth_client_refresh`,
-- `20260715180000_add_onboarding_state_mcp_connection` (the mcp_connections half
-- — the onboarding half belongs to @12-apps/onboarding) and
-- `20260720120000_add_mcp_connection_host` verbatim, minus the FK to `users`:
-- this package cannot know the name of a host's user table, and a host that has
-- one keeps its own constraint (the origin host's is ON DELETE CASCADE).
--
-- EVERY statement is guarded (`IF NOT EXISTS`, and a conrelid-scoped DO block for
-- the CHECK, which has no IF NOT EXISTS form). That is what makes adoption by a
-- host that ALREADY has these tables a no-op instead of a failed deploy — and
-- what lets the PGlite provisioner replay it into an existing schema.
--
-- Guarding every STATEMENT is not the same as guarding every COLUMN, though, and
-- the difference bites exactly the host this file is written for: `CREATE TABLE IF
-- NOT EXISTS` skips the whole table, columns included, so a host holding an OLDER
-- shape of one of these tables silently keeps it. Each table below is therefore
-- followed by a guarded `ADD COLUMN` for every column that reached the origin host in a
-- LATER migration than its own CREATE. The full audit: `oauth_refresh_tokens
-- .user_sub` (`20260713150000_add_oauth_refresh_user_sub`) and `mcp_connections
-- .host` (`20260720120000_add_mcp_connection_host`). `oauth_clients` needs none —
-- it arrived complete, CHECK and all, and was never altered afterwards. A column
-- added to this file later needs the same treatment.

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
-- plaintext); user_email is the bound identity; user_sub is the original OAuth
-- subject, kept stable across every rotation; client_id is a by-value link to
-- oauth_clients.client_id; rotated_from carries the prior token's hash for
-- rotation lineage / replay detection; revoked_at is the explicit revoke path.
CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_sub" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_from" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Lookup-on-presentation: hash the incoming token, find its row. Unique so a
-- duplicate insert is a DB-level error rather than a silent second live token.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_refresh_tokens_token_hash_key"
  ON "oauth_refresh_tokens"("token_hash");

-- Per-user/per-client enumeration + bulk revoke (the lineage walk's input, and
-- the disconnect path).
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_user_email_client_id_idx"
  ON "oauth_refresh_tokens"("user_email", "client_id");

-- `CREATE TABLE IF NOT EXISTS` skips the WHOLE table, so a host that already holds
-- `oauth_refresh_tokens` in an OLDER SHAPE gets none of the columns declared above
-- — statement-level guarding is not the same as column-level guarding. That is
-- precisely how the origin host's own history ran: `user_sub` arrived in a SECOND
-- migration (FUT-105, `20260713150000_add_oauth_refresh_user_sub`), so a host
-- frozen before it would adopt this file, skip the CREATE, never get the column,
-- and then fail on every refresh the package serves. Mirror the origin host's pair
-- verbatim — guarded add with a backfill default to satisfy NOT NULL, then drop
-- the default so the column matches the Prisma schema (`String`, no default).
-- Both statements are no-ops on a fresh host and on a replay.
ALTER TABLE "oauth_refresh_tokens"
  ADD COLUMN IF NOT EXISTS "user_sub" TEXT NOT NULL DEFAULT '';
ALTER TABLE "oauth_refresh_tokens"
  ALTER COLUMN "user_sub" DROP DEFAULT;

-- A user's live AI connections. `host` is nullable: a connection can exist before
-- any provider attribution is derivable (a CLI callback with no public domain).
CREATE TABLE IF NOT EXISTS "mcp_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_client_id" TEXT NOT NULL,
    "client_name" TEXT,
    "host" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);

-- One connection row per (user, OAuth client) — the upsert key for liveness.
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_connections_user_id_oauth_client_id_key"
  ON "mcp_connections"("user_id", "oauth_client_id");
CREATE INDEX IF NOT EXISTS "mcp_connections_user_id_idx" ON "mcp_connections"("user_id");
CREATE INDEX IF NOT EXISTS "mcp_connections_last_active_at_idx"
  ON "mcp_connections"("last_active_at");

-- A host adopting this migration where `mcp_connections` predates the `host`
-- column (the origin host added it in a later migration) gets it here; a fresh host
-- already has it from the CREATE above, so the guard makes both cases a no-op.
ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "host" TEXT;
