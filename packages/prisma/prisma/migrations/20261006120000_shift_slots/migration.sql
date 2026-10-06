-- @12-apps/shift: the schedule. A slot is a PLANNED work period, kept apart from
-- `shifts` (facts that happened, immutable once ended, one open per worker).
-- Tenant, user, kind and resource are stored by value, exactly as on `shifts`:
-- no foreign keys, the host owns what the values mean.
CREATE TABLE IF NOT EXISTS "shift_slots" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "coverage" JSONB,
    "series_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMP(3),
    "canceled_by_user_id" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "shift_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_slots_kind_present_check" CHECK (btrim("kind") <> ''),
    CONSTRAINT "shift_slots_time_order_check" CHECK ("ends_at" > "starts_at"),
    -- A slot longer than a day is a typo, not a plan.
    CONSTRAINT "shift_slots_max_length_check" CHECK ("ends_at" - "starts_at" <= interval '24 hours'),
    -- Who canceled and why exist only on a canceled slot; a sweep may cancel
    -- with no user, so the user stays optional even then.
    CONSTRAINT "shift_slots_cancel_state_check" CHECK (
      "canceled_at" IS NOT NULL
      OR ("canceled_by_user_id" IS NULL AND "cancel_reason" IS NULL)
    ),
    CONSTRAINT "shift_slots_resource_pair_check" CHECK (
      ("resource_type" IS NULL) = ("resource_id" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "shift_slots_client_id_starts_at_idx" ON "shift_slots"("client_id", "starts_at");
CREATE INDEX IF NOT EXISTS "shift_slots_client_id_user_id_starts_at_idx" ON "shift_slots"("client_id", "user_id", "starts_at");
CREATE INDEX IF NOT EXISTS "shift_slots_series_id_idx" ON "shift_slots"("series_id");
