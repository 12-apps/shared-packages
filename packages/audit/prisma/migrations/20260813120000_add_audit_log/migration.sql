-- @12-apps/audit (12-14): the append-only action audit log, owned by the
-- package and copied into a host's migrations folder by its plugin-migration
-- sync. Runs identically on PostgreSQL and PGlite.
--
-- Append-only is enforced at the CLIENT layer (update/upsert/delete on the
-- model throw — see src/server/append-only-extension.ts), not by a DB trigger,
-- matching the house pattern. The only sanctioned removal is the retention
-- sweep, which goes through raw SQL over the `created_at` index below. Raw SQL
-- therefore BYPASSES the guard entirely — that is the documented blind spot,
-- and it is what makes the sweep possible at all.
--
-- ── REPLAY-SAFE ON PURPOSE ────────────────────────────────────────────────
-- Every statement here is idempotent (`IF NOT EXISTS`), because the first host
-- to adopt this package already HAS an `audit_logs` table created by its own,
-- earlier migration. A package migration is applied by name order, so this one
-- sorts AFTER the host's — and a bare `CREATE TABLE` would then fail
-- `prisma migrate deploy` on an existing database AND on a fresh one built from
-- the full folder. `prisma migrate resolve --applied` can only paper over the
-- first case, by hand, once per database; three PRs in this series have already
-- hit that wall (one deferred adoption entirely, one had to teach the plugin
-- sync a name-keyed carve-out). So the migration adopts an existing table
-- instead of demanding a baseline:
--
--   * a fresh host gets the table, the column and the five indexes;
--   * a host that already has the table gets only what it is missing;
--   * replaying the whole folder is a no-op.
--
-- What it deliberately does NOT do is reconcile a DIFFERENT shape. If a host's
-- pre-existing `audit_logs` is missing a column this package writes (other than
-- `on_behalf_of_user_id`, handled below) or types one differently, that is a
-- real divergence and belongs in the host's own migration — silently altering
-- columns under an append-only trail is not something a package should do.

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" TEXT,
    "scope" TEXT,
    "on_behalf_of_user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- The impersonation half of the attribution pair, as a separate ADD COLUMN and
-- not only as a column of the CREATE above: a host that adopted an audit table
-- before impersonation existed has the table but not the column, and the
-- CREATE is a no-op for it. Nullable, no default, no backfill — NULL is the
-- honest and permanent value for every write made outside a session, and this
-- table is append-only, so the value is written at INSERT or never.
-- ADD COLUMN of a nullable column with no default is metadata-only in
-- PostgreSQL (no rewrite, no scan), so it is safe on a large trail.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "on_behalf_of_user_id" TEXT;

-- The viewer's tenant-scoped filters: date (the default newest-first listing),
-- actor, resource.
CREATE INDEX IF NOT EXISTS "audit_logs_client_id_created_at_idx"
    ON "audit_logs"("client_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_client_id_actor_user_id_created_at_idx"
    ON "audit_logs"("client_id", "actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_client_id_resource_type_resource_id_idx"
    ON "audit_logs"("client_id", "resource_type", "resource_id");
-- Action-pinned reads: the equality columns first, then the ORDER BY column.
CREATE INDEX IF NOT EXISTS "audit_logs_client_id_action_resource_type_created_at_idx"
    ON "audit_logs"("client_id", "action", "resource_type", "created_at");
-- Serves the retention sweep.
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- ⚠️ NOT CONCURRENTLY, and on a large existing trail that is a LOCK to plan
-- for rather than a footnote: `prisma migrate deploy` wraps each migration in a
-- transaction and `CREATE INDEX CONCURRENTLY` cannot run inside one, so each
-- build above takes a SHARE lock on `audit_logs` — and the writer inserts into
-- that table INSIDE every audited transaction, so those transactions block for
-- as long as the build takes.
--
-- RUNBOOK for a large deployment: build them out of band FIRST, against the
-- live database, before releasing — `CREATE INDEX CONCURRENTLY IF NOT EXISTS
-- <name> ON "audit_logs"(…)` with the names above — and every statement here
-- then finds its index present and is a no-op. On a fresh or small database,
-- just let the migration build them.
