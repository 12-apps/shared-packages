-- The period a saved report OPENS on (FUT-755). Nullable: NULL means "no
-- preference", which readers resolve to 30d — the behaviour every existing row
-- already has, so this migration changes nothing about them.
ALTER TABLE "saved_reports"
  ADD COLUMN IF NOT EXISTS "default_range" TEXT;

-- The presets the range API actually supports (REPORT_RANGES). Enforced here as
-- well as at the wire, because the store is written by MCP authors too and a
-- value the reader cannot resolve would open the report on nothing.
ALTER TABLE "saved_reports"
  DROP CONSTRAINT IF EXISTS "saved_reports_default_range_check";

ALTER TABLE "saved_reports"
  ADD CONSTRAINT "saved_reports_default_range_check"
    CHECK ("default_range" IS NULL OR "default_range" IN ('today', '7d', '30d'));
