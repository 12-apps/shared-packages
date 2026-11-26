-- @domains: notifications
-- @12-apps/notifications: a GUEST recipient — a phone with no account (`notifyGuest`).
--
-- EXPAND-ONLY, so the previous release keeps working against this schema for
-- the length of a rollout: two NOT NULLs relaxed, one nullable column, one CHECK
-- left NOT VALID (every existing row satisfies it anyway), and one partial
-- unique index over rows the previous release never writes (it writes no NULL
-- user_id anywhere).
--
-- Replay-safe like every migration of this package: each statement is guarded
-- or converges when it runs twice.

-- ---------------------------------------------------------------------------
-- notifications: a row is an account's (user_id) or a guest's (recipient_phone).
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT;

-- Exactly one of the two, added NOT VALID and LEFT so. Prisma sends this file
-- as one script, which Postgres runs as ONE implicit transaction, so the
-- ACCESS EXCLUSIVE locks the DROP NOT NULL and the ADD CONSTRAINT take are held
-- to the end of the file: a VALIDATE here would hold them through a scan of
-- the whole of `notifications`, the package's largest table, to refuse nothing
-- (every existing row holds a user_id and no recipient_phone). NOT VALID still
-- enforces the CHECK on every row inserted or updated from now on. The
-- precedent `20261116190000_paid_channel_consent` validated a moderate table in
-- the same transaction and said so; this one does not. A host that wants the
-- constraint marked validated runs, apart and off-peak:
--   ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_recipient_check";
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_recipient_check'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_recipient_check"
      CHECK (("user_id" IS NOT NULL) <> ("recipient_phone" IS NOT NULL))
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- notification_channel_consents: a guest's STOP is kept by NUMBER, with no
-- account. One row per (number, channel); the account rows keep their unique
-- (user_id, channel), which NULLs never collide on.
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_channel_consents" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_channel_consents_guest_destination_channel_key"
    ON "notification_channel_consents"("destination", "channel")
    WHERE "user_id" IS NULL;
