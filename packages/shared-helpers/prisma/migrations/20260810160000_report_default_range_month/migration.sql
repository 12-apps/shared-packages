-- `Este mês` joins the period toggle (FUT-755), so it joins the periods a saved
-- report may OPEN on. The CHECK is the third place the list is written — after
-- `REPORT_DEFAULT_RANGES` and the wire's `z.enum` — and the one an MCP author
-- writing straight to the store hits, so it has to learn the new value or a
-- report whose default the toggle offers cannot be saved.
--
-- Re-stated rather than altered: Postgres has no `ALTER CONSTRAINT` for a
-- CHECK's expression, and DROP-then-ADD under `IF EXISTS` is idempotent, so
-- this replays cleanly onto a database that already ran it.
ALTER TABLE "saved_reports"
  DROP CONSTRAINT IF EXISTS "saved_reports_default_range_check";

ALTER TABLE "saved_reports"
  ADD CONSTRAINT "saved_reports_default_range_check"
    CHECK ("default_range" IS NULL OR "default_range" IN ('today', '7d', '30d', 'month'));
