-- Reusable guided-onboarding progress + live AI (MCP) connection tracking
-- (FUT-178 flagship). `onboarding_states` is ONE table backing every guided
-- setup, namespaced by `feature_key`; one row per (user, tenant, feature). It
-- persists which `step` the user stopped on (resume point) and an opaque `data`
-- JSON payload per feature. `mcp_connections` records that a user authorized an
-- AI host (Claude/ChatGPT) and how recently it was active (auth-passthrough is
-- per-user, so this is NOT tenant-scoped). Both use the String+CHECK house
-- style for enumerated columns.

CREATE TABLE "onboarding_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "step" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_states_pkey" PRIMARY KEY ("id")
);

-- One progress row per (user, tenant, feature) — the upsert key.
CREATE UNIQUE INDEX "onboarding_states_user_id_client_id_feature_key_key" ON "onboarding_states"("user_id", "client_id", "feature_key");

-- Cross-tenant "who is mid-integration" query (superadmin panel, FUT-189).
CREATE INDEX "onboarding_states_client_id_feature_key_status_idx" ON "onboarding_states"("client_id", "feature_key", "status");

-- DB-enforced status domain (raw CHECK — Prisma models can't express it).
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_status_valid" CHECK ("status" IN ('not_started', 'in_progress', 'completed', 'dismissed'));

-- Progress belongs to a user and a tenant; deleting either cascades its rows.
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mcp_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth_client_id" TEXT NOT NULL,
    "client_name" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);

-- One connection row per (user, OAuth client) — the upsert key for liveness.
CREATE UNIQUE INDEX "mcp_connections_user_id_oauth_client_id_key" ON "mcp_connections"("user_id", "oauth_client_id");
CREATE INDEX "mcp_connections_user_id_idx" ON "mcp_connections"("user_id");
CREATE INDEX "mcp_connections_last_active_at_idx" ON "mcp_connections"("last_active_at");

-- Connections belong to a user; deleting the user cascades them.
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
