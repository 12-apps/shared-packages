-- @12-apps/notifications: which ATTENTION pushes a device wants.
--
-- The attention button's push setting is the DEVICE's — the counter tablet may
-- want every new call while the owner's phone wants only what turned late —
-- and a browser that is closed cannot filter a push itself: Chrome shows
-- something for every push that reaches a hidden page. So the level lives on
-- the subscription, sent by the device's own app, and the WEB_PUSH transport
-- skips the devices whose level does not want a notification's
-- `data.attention` severity.
--
-- NULL means "every attention push", which is what every existing row reads
-- as, and a notification without `data.attention` ignores the column: additive
-- DDL, a MINOR release, no backfill.
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "attention_push" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_attention_push_check'
  ) THEN
    ALTER TABLE "push_subscriptions"
      ADD CONSTRAINT "push_subscriptions_attention_push_check"
      CHECK ("attention_push" IS NULL OR "attention_push" IN ('off', 'late', 'all'));
  END IF;
END $$;
