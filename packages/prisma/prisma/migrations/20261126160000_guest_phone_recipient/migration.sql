-- @domains: notifications
-- @12-apps/notifications: a GUEST recipient — a phone with no account (`notifyGuest`).
--
-- EXPAND-ONLY, so the previous release keeps working against this schema for
-- the length of a rollout: two NOT NULLs relaxed, one nullable column, one CHECK
-- every existing row already satisfies, and one partial unique index over rows
-- the previous release never writes (it writes no NULL user_id anywhere).
--
-- Replay-safe like every migration of this package: each statement is guarded
-- or converges when it runs twice.

-- ---------------------------------------------------------------------------
-- notifications: a row is an account's (user_id) or a guest's (recipient_phone).
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT;

-- Exactly one of the two. NOT VALID + VALIDATE as the previous migration does:
-- in one implicit transaction it shortens nothing, and it is correct for a host
-- applying the file statement by statement. Every existing row holds a user_id
-- and no recipient_phone, so the scan finds nothing to refuse.
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
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_recipient_check";

-- ---------------------------------------------------------------------------
-- notification_channel_consents: a guest's STOP is kept by NUMBER, with no
-- account. One row per (number, channel); the account rows keep their unique
-- (user_id, channel), which NULLs never collide on.
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_channel_consents" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_channel_consents_guest_destination_channel_key"
    ON "notification_channel_consents"("destination", "channel")
    WHERE "user_id" IS NULL;
