-- @12-apps/shift: a shift's kind set belongs to the HOST.
--
-- `shifts_kind_check` enumerated the two kinds of the single application this
-- package was extracted from. That made one host's roster a constraint in every
-- adopter's database: a clinic could not insert a shift for a ward, and the
-- failure arrived as a checksum-stable CHECK violation with no way to widen it
-- short of forking the package.
--
-- This migration is deliberately separable from the code change that makes the
-- kind set required service configuration: current code validates its two
-- literals before any INSERT, so widening the column first changes nothing it
-- can observe — the database simply stops duplicating a rule that is about to
-- become the host's. What the column still guarantees is the part that is true
-- for everyone: a kind is present and not blank.
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_kind_check";

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_kind_check" CHECK (length(btrim("kind")) > 0);
