-- E-mail delivery schedule of a saved report (FUT-776). Nullable JSON: NULL
-- means "never scheduled", which is every existing row, so this migration
-- changes nothing about them. The shape is validated at the wire and re-read
-- tolerantly by the package, so no CHECK constraint pins it here.
ALTER TABLE "saved_reports"
  ADD COLUMN IF NOT EXISTS "schedule" JSONB;
