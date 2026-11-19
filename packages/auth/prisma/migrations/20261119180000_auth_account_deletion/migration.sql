-- Deleting one's own account: the session revocation counter, the grace
-- window and its reminders. A new table, so additive: the previous release
-- never reads it, and a user with no row is epoch 0 with nothing scheduled.
CREATE TABLE "auth_account_states" (
  "user_id" TEXT NOT NULL,
  "session_epoch" INTEGER NOT NULL DEFAULT 0,
  "requested_at" TIMESTAMP(3),
  "purge_at" TIMESTAMP(3),
  "reminded_week_at" TIMESTAMP(3),
  "reminded_day_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_account_states_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX "auth_account_states_purge_at_idx" ON "auth_account_states"("purge_at");
