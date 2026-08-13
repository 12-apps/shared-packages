-- @12-apps/onboarding (12-23): the guided-onboarding progress table, owned by
-- the package and copied into a host's migrations folder by its
-- plugin-migration sync.
--
-- The columns, defaults, indexes and the status CHECK are future-pay's
-- `20260715180000_add_onboarding_state_mcp_connection` verbatim, minus two
-- things that are the HOST's vocabulary rather than the package's:
--
--   * the FKs to `users` / `clients` — this package cannot know the name of a
--     host's user or tenant table. A host that has them keeps its own
--     constraints (future-pay's are ON DELETE CASCADE) and they stay
--     compatible with everything the package writes;
--   * the `mcp_connections` half of that migration, which belongs to
--     @12-apps/mcp and ships in ITS folder.
--
-- EVERY statement is guarded (`IF NOT EXISTS`, and a conrelid-scoped DO block
-- for the CHECK, which has no IF NOT EXISTS form). That is what makes adoption
-- by a host that ALREADY has the table a no-op instead of a failed deploy —
-- future-pay applies this and nothing changes, no `prisma migrate resolve`
-- dance required. It is also what lets the PGlite provisioner replay it into an
-- existing schema, which is how the harness and the integration suites run.

CREATE TABLE IF NOT EXISTS "onboarding_states" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_states_user_id_client_id_feature_key_key"
  ON "onboarding_states"("user_id", "client_id", "feature_key");

-- The "who is mid-integration" reach-out query (per tenant, per feature).
CREATE INDEX IF NOT EXISTS "onboarding_states_client_id_feature_key_status_idx"
  ON "onboarding_states"("client_id", "feature_key", "status");

-- DB-enforced status domain: the package's own `OnboardingStatus` union, so the
-- closed set is the package's contract rather than a host's preference. Scoped
-- to conrelid because constraint names are unique only per table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'onboarding_states_status_valid'
      AND conrelid = 'onboarding_states'::regclass
  ) THEN
    ALTER TABLE "onboarding_states"
      ADD CONSTRAINT "onboarding_states_status_valid"
      CHECK ("status" IN ('not_started', 'in_progress', 'completed', 'dismissed'));
  END IF;
END $$;
