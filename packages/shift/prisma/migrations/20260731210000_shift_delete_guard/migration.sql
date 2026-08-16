-- @12-apps/shift (FUT-446): the immutability guard becomes UPDATE-only.
--
-- The original trigger fired `BEFORE UPDATE OR DELETE` and raised
-- unconditionally on DELETE. `shifts.client_id` is a by-value tenant reference
-- with no foreign key (that is what keeps the package host-agnostic), so a host
-- that deletes its tenant row and then sweeps the remaining by-value tables by
-- `client_id` could never remove a shift: the RAISE aborted the whole
-- transaction. Future Pay's demo-store reset does exactly that on EVERY deploy,
-- so a single shift row would have wedged the deploy step.
--
-- Deletability is host policy, not a package invariant. What the guard actually
-- protects — a closed shift is an immutable work record, and a shift's
-- identity/resource snapshot never changes — is entirely an UPDATE concern and
-- is preserved verbatim below. The package still exposes no delete API.
DROP TRIGGER IF EXISTS "shifts_immutable_guard" ON "shifts";

CREATE OR REPLACE FUNCTION "guard_shift_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."ended_at" IS NOT NULL THEN
    RAISE EXCEPTION 'closed shifts are immutable';
  END IF;

  IF NEW."client_id" IS DISTINCT FROM OLD."client_id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
     OR NEW."resource_assignment_id" IS DISTINCT FROM OLD."resource_assignment_id"
     OR NEW."resource_type" IS DISTINCT FROM OLD."resource_type"
     OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id" THEN
    RAISE EXCEPTION 'shift identity and resource snapshots are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "shifts_immutable_guard"
BEFORE UPDATE ON "shifts"
FOR EACH ROW
EXECUTE FUNCTION "guard_shift_immutability"();
