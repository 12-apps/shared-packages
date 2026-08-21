-- @12-apps/shift: `kind` carries HOST vocabulary, so the database stops naming it.
--
-- `shifts_kind_check` restricted every adopter's `shifts.kind` to two values
-- taken from the staff structure of the application this package was extracted
-- from. That is the most structural form this leak can take. A leaked string is
-- cosmetic and a leaked type union is at least deletable in a major; a CHECK
-- constraint is a fact recorded in the adopter's own database, and a host whose
-- workers are not organised into those two groups could not insert a row at all
-- — no configuration this package offered could reach it.
--
-- What replaces it is the guarantee the package genuinely owns: `kind` is
-- present and not blank. WHICH kinds exist is now stated by the host and
-- enforced at the open, by the service, against the vocabulary it was
-- constructed with (`createShiftService(db, { kinds })`).
--
-- Deliberately NOT touched: `shifts_ended_reason_check`. Those three values are
-- this package's own vocabulary — a shift ends because a worker said so, a
-- supervisor said so, or the sweep did — and no adopter renames them.
--
-- Existing rows all satisfy the replacement, so this is safe to deploy against
-- a live table with no backfill.
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_kind_check";

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_kind_present_check" CHECK (btrim("kind") <> '');
