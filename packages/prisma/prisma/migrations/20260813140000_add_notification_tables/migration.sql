-- @12-apps/notifications (12-15): the four generic notification tables, owned
-- by the package and copied into a host's migrations folder by its
-- plugin-migration sync. Runs identically on PostgreSQL + PGlite.
--
-- NO foreign keys into host tables (the payments-backend doctrine): `user_id`
-- and `client_id` are by-value scalars, and the host's own migration may add FK
-- constraints (recommended: both ON DELETE CASCADE). The relation INTERNAL to
-- the partial — notification_deliveries -> notifications — IS constrained, with
-- a cascade, so a purged notification can never leave orphan delivery rows.
--
-- `channel` and `status` carry CHECKs: those are the LIBRARY's own closed sets,
-- and a row outside them is a row no transport can carry. `category` does NOT,
-- for the reason `@12-apps/rbac` gives for `role`: the category set is host
-- vocabulary (`categories` on the server config), so a closed set here would be
-- wrong for every host but the first. A host that wants its own CHECK adds one.
--
-- The `status` set is QUEUED | SENDING | SENT | FAILED | DEAD. `SENDING` is the
-- dispatcher's CLAIM and `DEAD` is terminal (see `src/server/dispatch.ts`), and
-- both are newer than the first adopters' hand-made tables — which is why the
-- status CHECK below is DROPPED and re-added rather than guarded by a
-- `pg_constraint` lookup like the others. An existence guard would find the
-- three-value constraint an early adopter already has, skip, and leave the claim
-- rejected at runtime by a CHECK that predates it.
--
-- ============================ REPLAY SAFETY ================================
-- Every statement is guarded, because the first adopters ALREADY HAVE these
-- tables: the origin host created them by hand before the package existed, so this
-- migration must be a no-op there and correct on an empty database.
--
-- The guards are per COLUMN, not per table. `CREATE TABLE IF NOT EXISTS` alone
-- is the trap: it skips the whole table, so a host whose table predates a
-- column silently never gets that column and the failure surfaces later as a
-- missing-column error in production. So each table is followed by one
-- `ADD COLUMN IF NOT EXISTS` per column, and every NOT NULL column carries a
-- DEFAULT — a NOT NULL column with no default cannot be added to a table that
-- already holds rows.
--
-- CHECK constraints have no `IF NOT EXISTS` form, so they are guarded by a
-- `pg_constraint` lookup instead (plpgsql, which PGlite has) — EXCEPT the
-- delivery status CHECK, which must CONVERGE rather than be skipped and so is
-- `DROP CONSTRAINT IF EXISTS` + `ADD`. Same for the sweep's index, which moved
-- key: `DROP INDEX IF EXISTS` + `CREATE INDEX IF NOT EXISTS`. Both are
-- idempotent, which is the property replay safety actually needs — "guarded" was
-- only ever the usual way to get it, and it is the wrong way when the definition
-- itself has changed under an existing adopter.

-- ---------------------------------------------------------------------------
-- notifications — the always-on inbox. One row per emit, written before any
-- transport is consulted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "client_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "body" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "data" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Inbox list (owner, not-deleted, newest first) + the unread badge count.
CREATE INDEX IF NOT EXISTS "notifications_user_id_deleted_at_created_at_idx"
    ON "notifications"("user_id", "deleted_at", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_deleted_at_read_at_idx"
    ON "notifications"("user_id", "deleted_at", "read_at");

-- ---------------------------------------------------------------------------
-- notification_deliveries — one row per channel the router fanned out to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "notification_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'QUEUED';
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "error" TEXT;
-- The retry ceiling's counter (12-15). An adopter whose table predates it gets
-- it at 0, which reads as "never claimed" — the correct starting point for a row
-- that has, in the new lifecycle's terms, spent no attempts.
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3);
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The library's own closed sets. A delivery outside them is a delivery no
-- transport can carry, so the schema refuses it rather than the router.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_channel_check'
  ) THEN
    ALTER TABLE "notification_deliveries"
      ADD CONSTRAINT "notification_deliveries_channel_check"
      CHECK ("channel" IN ('EMAIL', 'SMS', 'WHATSAPP', 'WEB_PUSH'));
  END IF;
END $$;

-- The status set, DROP-and-re-ADD rather than guarded (see the header): the
-- values widened in 12-15, so an adopter already holding a constraint under this
-- name holds the OLD three, and a guard would keep it — rejecting the claim's
-- own UPDATE. Idempotent, and re-running it converges rather than accumulating.
ALTER TABLE "notification_deliveries"
    DROP CONSTRAINT IF EXISTS "notification_deliveries_status_check";
ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_status_check"
    CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD'));

-- Idempotent fan-out: re-dispatching a notification can never duplicate a
-- channel's delivery row. This is what makes transport sends retry-safe.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_notification_id_channel_key"
    ON "notification_deliveries"("notification_id", "channel");
-- Serves the retry sweep, which selects `status IN (…) AND updated_at < cutoff`.
-- On `updated_at`, not `created_at`: the sweep asks "has this row moved lately",
-- and `created_at` cannot answer that — a row re-queued a second ago still
-- carries a `created_at` from days back, so it reads as stale again immediately.
-- The `(status, created_at)` index this replaces served the earlier, wrong
-- predicate and is dropped rather than left behind to cost every write.
DROP INDEX IF EXISTS "notification_deliveries_status_created_at_idx";
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_updated_at_idx"
    ON "notification_deliveries"("status", "updated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_notification_id_fkey'
  ) THEN
    ALTER TABLE "notification_deliveries"
      ADD CONSTRAINT "notification_deliveries_notification_id_fkey"
      FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- notification_preferences — EXPLICIT choices only; no row means the defaults.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "channels" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_category_key"
    ON "notification_preferences"("user_id", "category");

-- ---------------------------------------------------------------------------
-- push_subscriptions — the Web Push destination, one row per browser.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "endpoint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "p256dh" TEXT NOT NULL DEFAULT '';
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "auth" TEXT NOT NULL DEFAULT '';
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The push-service endpoint is globally unique per subscription — registering
-- the same browser again upserts rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"
    ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx"
    ON "push_subscriptions"("user_id");
