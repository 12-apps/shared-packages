-- @12-apps/shift (FUT-446): immutable work periods and optional tenant policy.
CREATE TABLE "shifts" (
    "id"                     TEXT NOT NULL,
    "client_id"              TEXT NOT NULL,
    "user_id"                TEXT NOT NULL,
    "kind"                   TEXT NOT NULL,
    "started_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"               TIMESTAMP(3),
    "ended_reason"           TEXT,
    "ended_by_user_id"       TEXT,
    "resource_assignment_id" TEXT,
    "resource_type"          TEXT,
    "resource_id"            TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shifts_kind_check"
      CHECK ("kind" IN ('kitchen', 'service')),
    CONSTRAINT "shifts_ended_reason_check"
      CHECK ("ended_reason" IS NULL OR "ended_reason" IN ('user', 'supervisor', 'auto')),
    CONSTRAINT "shifts_end_state_check"
      CHECK (
        ("ended_at" IS NULL AND "ended_reason" IS NULL AND "ended_by_user_id" IS NULL)
        OR
        ("ended_at" IS NOT NULL AND "ended_reason" IS NOT NULL
          AND ("ended_reason" = 'auto' OR "ended_by_user_id" IS NOT NULL))
      ),
    CONSTRAINT "shifts_time_order_check"
      CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
    CONSTRAINT "shifts_resource_snapshot_check"
      CHECK (
        ("resource_assignment_id" IS NULL AND "resource_type" IS NULL AND "resource_id" IS NULL)
        OR
        ("resource_assignment_id" IS NOT NULL AND "resource_type" IS NOT NULL AND "resource_id" IS NOT NULL)
      )
);

CREATE UNIQUE INDEX "shifts_resource_assignment_id_key"
  ON "shifts"("resource_assignment_id");

-- Prisma cannot express a partial unique index. This is the concurrency
-- guarantee: two tabs may race the pre-check, but only one open period commits.
CREATE UNIQUE INDEX "shifts_open_client_user_key"
  ON "shifts"("client_id", "user_id")
  WHERE "ended_at" IS NULL;

CREATE INDEX "shifts_client_id_ended_at_idx"
  ON "shifts"("client_id", "ended_at");

CREATE INDEX "shifts_client_id_user_id_started_at_idx"
  ON "shifts"("client_id", "user_id", "started_at");

-- A shift's identity/resource snapshots never change, and a closed row is the
-- immutable work record. The service exposes no edit/delete API; this trigger
-- keeps direct SQL and future adapters from creating a back door around it.
CREATE FUNCTION "guard_shift_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shift records cannot be deleted';
  END IF;

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
BEFORE UPDATE OR DELETE ON "shifts"
FOR EACH ROW
EXECUTE FUNCTION "guard_shift_immutability"();

CREATE TABLE "shift_tenant_configs" (
    "client_id"        TEXT NOT NULL,
    "auto_close_hours" INTEGER NOT NULL DEFAULT 16,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_tenant_configs_pkey" PRIMARY KEY ("client_id"),
    CONSTRAINT "shift_tenant_configs_auto_close_hours_check"
      CHECK ("auto_close_hours" BETWEEN 1 AND 168)
);
