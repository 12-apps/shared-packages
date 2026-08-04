-- FUT-138: tenant-authored custom reports — the report-builder JSON ReportSpec
-- persisted as data. Owned by @12-apps/report-builder (this migration reaches the
-- host's migrations folder as a committed symlink). Unique per (client, name)
-- so MCP authoring can upsert by name. Deliberately NO foreign key into host
-- tables (self-contained package schema, payments-backend doctrine): the host
-- repository layer scopes every read/write by client_id.
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "spec" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_reports_client_id_name_key" ON "saved_reports"("client_id", "name");

CREATE INDEX "saved_reports_client_id_idx" ON "saved_reports"("client_id");
