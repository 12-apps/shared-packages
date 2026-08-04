-- Price sources become soft-deletable (FUT-433).
--
-- Deleting a source must keep past research runs readable: `supplier_offers`
-- rows point at the source (`source_id`), and a run's report renders the
-- supplier name / source type it snapshotted by value. A hard DELETE would
-- SET NULL the FK (the schema's backstop), but soft-delete is strictly better
-- here — the row survives, so `source_id` keeps resolving, and the roster,
-- new runs and manual imports simply filter `archived_at IS NULL`. Same
-- doctrine as the host's Discount model: history-bearing rows are archived,
-- never removed. There is no restore path.
ALTER TABLE "price_sources" ADD COLUMN "archived_at" TIMESTAMP(3);

-- The tenant unique on (client_id, name) becomes PARTIAL, binding LIVE rows
-- only. Unconditional, a deleted "Atacadão" would squat its name forever —
-- the exact dead-duplicate pile-up this migration exists to clean up. The
-- index NAME is preserved so a P2002 keeps classifying by constraint name.
-- Partial indexes are plain PostgreSQL and PGlite runs the real engine, so
-- this replays identically there; IF EXISTS / IF NOT EXISTS keep the replay
-- idempotent for suites that apply every migration into a fresh database.
DROP INDEX IF EXISTS "price_sources_client_id_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "price_sources_client_id_name_key"
    ON "price_sources"("client_id", "name")
    WHERE "archived_at" IS NULL;
