-- @domains: notifications
-- @12-apps/notifications: paid-channel policy — delivery receipts, per-number
-- consent, and paid-message caps.
--
-- ADDITIVE ONLY, so the previous release keeps working against this schema for
-- the length of a rollout: two nullable columns, two new tables, a unique index
-- over a column every existing row holds NULL in, and a status CHECK that only
-- WIDENS (the previous release writes none of the new values).
--
-- Replay-safe like every migration of this package: each statement is guarded
-- or converges when it runs twice.

-- ---------------------------------------------------------------------------
-- Delivery receipts: the provider's id, kept with SENT, and when the provider
-- said the message reached the handset.
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "provider_message_id" TEXT;
ALTER TABLE "notification_deliveries" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);

-- A receipt finds its row by (channel, provider id). UNIQUE, so one provider id
-- can never be two rows' receipt; Postgres treats NULLs as distinct, so every
-- row sent before this column (and every channel that answers no id) is free.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_channel_provider_message_id_key"
    ON "notification_deliveries"("channel", "provider_message_id");

-- The status set gains the receipt's two terminal answers. DROP + ADD as the
-- first migration does (the definition changed under existing adopters), but
-- added NOT VALID and validated separately: the ADD then takes no long lock,
-- and the VALIDATE scans the table under a lock that lets writes through.
ALTER TABLE "notification_deliveries"
    DROP CONSTRAINT IF EXISTS "notification_deliveries_status_check";
ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_status_check"
    CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'DELIVERED', 'UNDELIVERED'))
    NOT VALID;
ALTER TABLE "notification_deliveries"
    VALIDATE CONSTRAINT "notification_deliveries_status_check";

-- ---------------------------------------------------------------------------
-- notification_channel_consents — one row per (user, paid channel): the NUMBER
-- consent was asked or given for, and the bookkeeping that makes asking safe.
-- The code is stored as a salted hash, never in clear. `user_id` is by value
-- (no FK into a host table); a host's migration may add one, ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notification_channel_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "send_window_started_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "consent_text" TEXT,
    "consent_external_id" TEXT,
    "consent_at" TIMESTAMP(3),
    "asked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channel_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_channel_consents_user_id_channel_key"
    ON "notification_channel_consents"("user_id", "channel");
-- An inbound reply's lookup: every account holding a number on a channel.
CREATE INDEX IF NOT EXISTS "notification_channel_consents_destination_channel_idx"
    ON "notification_channel_consents"("destination", "channel");
-- The grandfathered ask's selection.
CREATE INDEX IF NOT EXISTS "notification_channel_consents_status_asked_at_idx"
    ON "notification_channel_consents"("status", "asked_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_channel_consents_channel_check'
  ) THEN
    ALTER TABLE "notification_channel_consents"
      ADD CONSTRAINT "notification_channel_consents_channel_check"
      CHECK ("channel" IN ('SMS', 'WHATSAPP'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_channel_consents_status_check'
  ) THEN
    ALTER TABLE "notification_channel_consents"
      ADD CONSTRAINT "notification_channel_consents_status_check"
      CHECK ("status" IN ('PENDING', 'CONFIRMED', 'GRANDFATHERED', 'OPTED_OUT'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_channel_consents_method_check'
  ) THEN
    ALTER TABLE "notification_channel_consents"
      ADD CONSTRAINT "notification_channel_consents_method_check"
      CHECK ("method" IN ('REPLY', 'CODE', 'GRANDFATHERED'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- notification_send_counters — paid messages counted per (scope, subject,
-- period): a person's day (`recipient`, `YYYY-MM-DD`) or a tenant's month
-- (`tenant`, `YYYY-MM`). Moved only by a conditional UPDATE (`count < cap`);
-- `notified_at` is the once-per-period tenant notice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notification_send_counters" (
    "scope" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_send_counters_pkey" PRIMARY KEY ("scope", "subject_id", "period")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_send_counters_scope_check'
  ) THEN
    ALTER TABLE "notification_send_counters"
      ADD CONSTRAINT "notification_send_counters_scope_check"
      CHECK ("scope" IN ('recipient', 'tenant'));
  END IF;
END $$;
