-- @12-apps/shift: series rules, a rolling horizon, in-place edits and breaks.
-- Additive only: a new table, nullable or defaulted columns on `shift_slots`,
-- CHECKs every existing row already satisfies (its new columns are all null or
-- false), and two indexes. Stored by value, with no foreign keys, as before.

-- The RULE a repeating series is built from. Its days are materialised as
-- ordinary `shift_slots` rows up to a horizon, by the package. A rule whose
-- `ends_on` is before its `starts_on` is closed — an undo retires one that way —
-- so there is deliberately no `ends_on >= starts_on` CHECK.
CREATE TABLE IF NOT EXISTS "shift_slot_series" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weekdays" INTEGER[] NOT NULL,
    "every_weeks" INTEGER,
    "monthly_nth" INTEGER,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "break_offset_minutes" INTEGER,
    "break_minutes" INTEGER,
    "time_zone" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "skipped_dates" DATE[] NOT NULL DEFAULT '{}',
    "previous_series_id" TEXT,
    "canceled_from" DATE,
    "ends_on_before_cancel" DATE,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "coverage" JSONB,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_slot_series_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_slot_series_kind_present_check" CHECK (btrim("kind") <> ''),
    CONSTRAINT "shift_slot_series_time_zone_present_check" CHECK (btrim("time_zone") <> ''),
    -- ISO weekdays, 1 = Monday ... 7 = Sunday, at least one.
    CONSTRAINT "shift_slot_series_weekdays_check" CHECK (
      cardinality("weekdays") >= 1 AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
    ),
    -- Exactly one repeat: every 1 or 2 weeks, or the Nth (1-5) of ONE weekday a month.
    CONSTRAINT "shift_slot_series_repeat_check" CHECK (("every_weeks" IS NULL) <> ("monthly_nth" IS NULL)),
    CONSTRAINT "shift_slot_series_every_weeks_check" CHECK ("every_weeks" IS NULL OR "every_weeks" IN (1, 2)),
    CONSTRAINT "shift_slot_series_monthly_check" CHECK (
      "monthly_nth" IS NULL OR ("monthly_nth" BETWEEN 1 AND 5 AND cardinality("weekdays") = 1)
    ),
    -- Wall-clock minutes from local midnight; an end at or before the start is the next day.
    CONSTRAINT "shift_slot_series_minutes_check" CHECK (
      "start_minutes" BETWEEN 0 AND 1439 AND "end_minutes" BETWEEN 0 AND 1439
    ),
    -- The break: both or neither, as offsets from the start, strictly inside the slot.
    -- The pair is tested on its own: half a break would make the rest NULL, which a CHECK lets through.
    CONSTRAINT "shift_slot_series_break_check" CHECK (
      ("break_offset_minutes" IS NULL) = ("break_minutes" IS NULL)
      AND ("break_offset_minutes" IS NULL OR (
        "break_offset_minutes" > 0 AND "break_minutes" > 0
        AND "break_offset_minutes" + "break_minutes" < CASE
          WHEN "end_minutes" > "start_minutes" THEN "end_minutes" - "start_minutes"
          ELSE "end_minutes" - "start_minutes" + 1440
        END
      ))
    ),
    CONSTRAINT "shift_slot_series_resource_pair_check" CHECK (
      ("resource_type" IS NULL) = ("resource_id" IS NULL)
    )
);

-- The daily extension reads the rules still open, in every tenant.
CREATE INDEX IF NOT EXISTS "shift_slot_series_ends_on_idx" ON "shift_slot_series"("ends_on");
CREATE INDEX IF NOT EXISTS "shift_slot_series_client_id_user_id_idx" ON "shift_slot_series"("client_id", "user_id");

-- A slot edited on its own (hours or date) is detached: a later rule change leaves it.
ALTER TABLE "shift_slots" ADD COLUMN IF NOT EXISTS "detached" BOOLEAN NOT NULL DEFAULT false;
-- The series a slot was handed out of, when its person changed.
ALTER TABLE "shift_slots" ADD COLUMN IF NOT EXISTS "origin_series_id" TEXT;
-- The rule's day a row was built for, kept when the row is moved: "this day exists".
ALTER TABLE "shift_slots" ADD COLUMN IF NOT EXISTS "series_date" DATE;
ALTER TABLE "shift_slots" ADD COLUMN IF NOT EXISTS "break_offset_minutes" INTEGER;
ALTER TABLE "shift_slots" ADD COLUMN IF NOT EXISTS "break_minutes" INTEGER;

-- Offsets from the start, so the break survives a slot across midnight or a
-- daylight-saving change: both or neither (tested on its own, since half a pair
-- would make the rest NULL and pass), strictly inside the slot.
-- Added NOT VALID, so the ALTER takes no long lock over a table with live rows,
-- then validated on its own (a scan that lets writes through); a re-run finds
-- the constraint already there, and validating a valid one is a no-op.
DO $$ BEGIN
    ALTER TABLE "shift_slots" ADD CONSTRAINT "shift_slots_break_check" CHECK (
      ("break_offset_minutes" IS NULL) = ("break_minutes" IS NULL)
      AND ("break_offset_minutes" IS NULL OR (
        "break_offset_minutes" > 0 AND "break_minutes" > 0
        AND "starts_at" + make_interval(mins => "break_offset_minutes" + "break_minutes") < "ends_at"
      ))
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "shift_slots" VALIDATE CONSTRAINT "shift_slots_break_check";

CREATE INDEX IF NOT EXISTS "shift_slots_origin_series_id_idx" ON "shift_slots"("origin_series_id");
