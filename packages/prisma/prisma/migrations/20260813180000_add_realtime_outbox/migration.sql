-- @12-apps/realtime (12-16): the transactional OUTBOX table, owned by the
-- package and copied into a host's migrations folder by its plugin-migration
-- sync. Deliberately NO foreign keys and NO tenant column (the
-- payments-backend doctrine): a row names a TOPIC, and a topic already carries
-- whatever scope it has (`tenant:<id>:orders`), so there is nothing here for a
-- host to reconcile with its own tenancy model.
--
-- Runs identically on PostgreSQL + PGlite.
--
-- ---------------------------------------------------------------------------
-- EVERY STATEMENT IS GUARDED, AND THE GUARD IS PER COLUMN — NOT PER TABLE.
-- ---------------------------------------------------------------------------
-- `CREATE TABLE IF NOT EXISTS` alone is NOT replay-safe, and the way it fails
-- is silent. It skips the WHOLE table, so a host that already has
-- `realtime_outbox_events` from an earlier version of this package — or from
-- its own hand-rolled outbox — adopts this migration, sees it succeed, and
-- never gets the columns added since. `claimed_at` / `claimed_by` are exactly
-- that case: the claim protocol is what makes two concurrent drains safe, and
-- a host silently missing those columns would have every drain fail on an
-- unknown column, or (worse, if the code were laxer) publish every row twice.
--
-- This hazard was PROVEN on PGlite against a sibling package (review of #156:
-- a host stopped at an earlier migration adopted a guarded `CREATE TABLE` and
-- the later column never appeared, so the package's client 500'd on every
-- call). So each column is added with its own `ADD COLUMN IF NOT EXISTS`, and
-- each index with `IF NOT EXISTS`. The whole file is idempotent and can be
-- applied to a fresh database, to a database that already has it, and to one
-- that has an older shape of it.
--
-- The two NOT NULL columns with no permanent default get one temporarily and
-- then drop it: `ADD COLUMN … NOT NULL` fails outright on a table that already
-- holds rows, and that is precisely the host this guard is for.

CREATE TABLE IF NOT EXISTS "realtime_outbox_events" (
    "id" TEXT NOT NULL,

    CONSTRAINT "realtime_outbox_events_pkey" PRIMARY KEY ("id")
);

-- The event itself.
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "topic" TEXT NOT NULL DEFAULT '';
ALTER TABLE "realtime_outbox_events" ALTER COLUMN "topic" DROP DEFAULT;
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT '';
ALTER TABLE "realtime_outbox_events" ALTER COLUMN "type" DROP DEFAULT;
-- Identifiers only, never state — the payload rule the whole bus is built on.
ALTER TABLE "realtime_outbox_events"
    ADD COLUMN IF NOT EXISTS "data" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "realtime_outbox_events"
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Null = still pending. Set once the event reached the bus.
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);

-- The claim protocol. `claimed_at` null (or older than the drainer's lease) is
-- what makes a row takeable; the claim is a conditional UPDATE, so PostgreSQL
-- decides the winner and two drains racing one row cannot both publish it.
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3);
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "claimed_by" TEXT;
-- Counts CLAIMS, not failures: a drainer that crashes mid-publish records no
-- failure, so a failure counter would let a poison row retry forever.
ALTER TABLE "realtime_outbox_events"
    ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "realtime_outbox_events" ADD COLUMN IF NOT EXISTS "last_error" TEXT;

-- The drain's own read: pending rows in commit order.
CREATE INDEX IF NOT EXISTS "realtime_outbox_events_published_at_created_at_idx"
    ON "realtime_outbox_events"("published_at", "created_at");
-- The purge's read: published rows older than a cutoff.
CREATE INDEX IF NOT EXISTS "realtime_outbox_events_published_at_idx"
    ON "realtime_outbox_events"("published_at");
