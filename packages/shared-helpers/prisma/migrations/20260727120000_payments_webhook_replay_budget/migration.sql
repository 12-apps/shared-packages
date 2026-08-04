-- @12-apps/payments-backend owned migration: give the webhook retry drain its own
-- retry budget (FUT-341 follow-up).
--
-- `attempts` was doing two incompatible jobs at once. It counted every
-- processing attempt AND it was the cap the drain used to decide a row had had
-- enough — but the live inbound path increments it too, and how often THAT
-- happens is the provider's decision, not ours.
--
-- The failure that forces this column: a store's order-confirmation handler
-- throws. The live delivery fails, the endpoint answers 5xx, and the provider
-- starts redelivering — every ten minutes or so, for hours. Each redelivery
-- re-enters the pipeline, fails again, and spends one of the ten attempts the
-- drain was supposed to have. Under two hours later the row is at the cap, drops
-- out of the drain's work list permanently, and has been replayed zero or one
-- times. The recovery mechanism disables itself precisely for the rows whose
-- provider retried hardest, and nothing reports it: a row that is not listed
-- moves no counter, so the drain looks idle and healthy.
--
-- So the two jobs get two columns. `attempts` stays what its name says — every
-- attempt, from either path, which is what support wants when asking "how many
-- times has anything tried this". `replay_attempts` is the drain's budget and
-- only the drain writes it.
--
-- Backfilled to 0 rather than to `attempts`. Nothing incremented `attempts`
-- before the drain existed, so every historical row's real replay count IS
-- zero; copying `attempts` across would import live-path failures as spent
-- budget and re-create the exact bug this column removes.
ALTER TABLE "payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "replay_attempts" INTEGER NOT NULL DEFAULT 0;

-- The drain's query, exactly: unsettled rows, one branch per eligible
-- `replay_attempts` count (each with its own `updated_at` backoff cutoff),
-- ordered by `updated_at`. Leading with `status` is what keeps it away from the
-- PROCESSED rows, which are the overwhelming majority of this table and grow
-- without bound while the unsettled set stays small.
CREATE INDEX IF NOT EXISTS "payment_webhook_events_replay_idx"
  ON "payment_webhook_events"("status", "replay_attempts", "updated_at");
