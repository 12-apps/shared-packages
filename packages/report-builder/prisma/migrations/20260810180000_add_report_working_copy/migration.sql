-- Unpublished changes to a PUBLISHED report (FUT-755).
--
-- A report already has `status` ('draft' | 'published' | 'archived'), but that
-- is the report's LIFECYCLE, not a revision of it: a report with status
-- 'draft' has never been published. Editing a PUBLISHED report is the case
-- this column exists for — its readers are looking at it right now, so the
-- in-progress edit is stored beside the live document and `spec` is left
-- alone until the author publishes.
--
-- NULL means "no unpublished changes", which is every row that predates this
-- migration, so nothing about existing reports changes.
ALTER TABLE "saved_reports"
  ADD COLUMN IF NOT EXISTS "working_copy" JSONB;
