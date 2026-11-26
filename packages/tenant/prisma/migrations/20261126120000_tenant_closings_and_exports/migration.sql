-- The tenant lifecycle's own tables. Two new tables, so additive: the previous
-- release never reads them, and nothing reads them until a host wires the
-- lifecycle. Keyed by an opaque `tenant_id` with NO foreign key: the tenant row
-- is the host's.
--
-- `tenant_closings`: one row per tenant while it is closing — when, by whom,
-- why, the status it started from, when it is purged, the two reminder stamps,
-- the after-close hook's outcome, and the storage keys the purge still owes.
--
-- `tenant_data_exports`: one row per export request — its state
-- (PREPARING | READY | FAILED), where the private archive is stored, when its
-- link expires, and whether it was mailed. At most ONE PREPARING row per
-- tenant (the partial unique index).

CREATE TABLE "tenant_closings" (
    "tenant_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "requested_by_id" TEXT,
    "reason" TEXT NOT NULL,
    "prior_status" TEXT,
    "purge_at" TIMESTAMP(3) NOT NULL,
    "reminded_week_at" TIMESTAMP(3),
    "reminded_day_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),
    "after_close_done_at" TIMESTAMP(3),
    "after_close_failed_at" TIMESTAMP(3),
    "image_keys_owed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "images_erased_at" TIMESTAMP(3),

    CONSTRAINT "tenant_closings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE INDEX "tenant_closings_purge_at_idx" ON "tenant_closings"("purge_at");

CREATE TABLE "tenant_data_exports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "storage_key" TEXT,
    "size_bytes" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notified_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_data_exports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_data_exports_status_check" CHECK ("status" IN ('PREPARING', 'READY', 'FAILED'))
);

CREATE INDEX "tenant_data_exports_tenant_id_requested_at_idx" ON "tenant_data_exports"("tenant_id", "requested_at");
CREATE INDEX "tenant_data_exports_status_requested_at_idx" ON "tenant_data_exports"("status", "requested_at");
CREATE UNIQUE INDEX "tenant_data_exports_one_preparing_key" ON "tenant_data_exports"("tenant_id") WHERE "status" = 'PREPARING';
