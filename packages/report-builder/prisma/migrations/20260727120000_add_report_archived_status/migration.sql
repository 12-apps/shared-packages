-- Archived reports (FUT-391): the Relatórios area retires a report instead of
-- deleting it — the picker stops offering it, the document (and every block
-- spec in it) survives for restore. Widen the lifecycle CHECK to admit it.
ALTER TABLE "saved_reports"
  DROP CONSTRAINT IF EXISTS "saved_reports_status_check";

ALTER TABLE "saved_reports"
  ADD CONSTRAINT "saved_reports_status_check"
    CHECK ("status" IN ('draft', 'published', 'archived'));
