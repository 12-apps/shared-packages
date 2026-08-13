-- @12-apps/entity-lifecycle (12-17): the four generic lifecycle tables, owned
-- by the package and copied into a host's migrations folder by its
-- plugin-migration sync. Deliberately NO foreign keys into host tables (the
-- payments-backend doctrine): `client_id`, `entity_id` and the actor ids are
-- by-value scalars, and the host's own migration may add FK constraints
-- (recommended: client_id ON DELETE CASCADE). The tree relation INTERNAL to
-- recycle_bin_entries IS constrained, with a cascade, so a removed root can
-- never leave orphan children. The CHECK constraints ARE here: kind/status/
-- action are the library's own closed sets, not host vocabulary.
--
-- Runs identically on PostgreSQL + PGlite.

-- ---------------------------------------------------------------------------
-- Version history. v1 (and any retention-compaction base) is a FULL snapshot;
-- other rows are DELTAS (changed top-level fields + removed field names). The
-- state at version N is rebuilt by replaying rows 1..N. Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE "entity_versions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "is_snapshot" BOOLEAN NOT NULL,
    "data" JSONB NOT NULL,
    "removed_fields" JSONB NOT NULL DEFAULT '[]',
    "actor_id" TEXT,
    "restored_from" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entity_versions_client_id_entity_type_entity_id_version_key"
    ON "entity_versions"("client_id", "entity_type", "entity_id", "version");
CREATE INDEX "entity_versions_client_id_entity_type_entity_id_idx"
    ON "entity_versions"("client_id", "entity_type", "entity_id");
-- Serves the retention sweep ("versions older than N days").
CREATE INDEX "entity_versions_created_at_idx" ON "entity_versions"("created_at");

ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_kind_check"
    CHECK ("kind" IN ('CREATE', 'UPDATE', 'RESTORE'));
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_version_positive"
    CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------
-- Recycle bin. A deletion records a TREE (root + one child per dependent
-- record, linked via parent_entry_id). Restore/purge keep the row as an audit
-- trail (status flip, never a delete).
-- ---------------------------------------------------------------------------
CREATE TABLE "recycle_bin_entries" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "parent_entry_id" TEXT,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELETED',
    "deleted_by" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recycle_bin_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recycle_bin_entries_client_id_status_deleted_at_idx"
    ON "recycle_bin_entries"("client_id", "status", "deleted_at");
CREATE INDEX "recycle_bin_entries_client_id_entity_type_entity_id_idx"
    ON "recycle_bin_entries"("client_id", "entity_type", "entity_id");
CREATE INDEX "recycle_bin_entries_parent_entry_id_idx"
    ON "recycle_bin_entries"("parent_entry_id");

ALTER TABLE "recycle_bin_entries" ADD CONSTRAINT "recycle_bin_entries_status_check"
    CHECK ("status" IN ('DELETED', 'RESTORED', 'PURGED'));
ALTER TABLE "recycle_bin_entries" ADD CONSTRAINT "recycle_bin_entries_parent_entry_id_fkey"
    FOREIGN KEY ("parent_entry_id") REFERENCES "recycle_bin_entries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Drafts. entity_id NULL = draft of a brand-new item. At most one OPEN draft
-- per (tenant, type, entity) — a partial unique index, which Prisma cannot
-- express in the schema (hence raw SQL here).
-- ---------------------------------------------------------------------------
CREATE TABLE "entity_drafts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_drafts_client_id_entity_type_status_idx"
    ON "entity_drafts"("client_id", "entity_type", "status");
CREATE INDEX "entity_drafts_client_id_entity_type_entity_id_idx"
    ON "entity_drafts"("client_id", "entity_type", "entity_id");
CREATE UNIQUE INDEX "entity_drafts_open_entity_key"
    ON "entity_drafts"("client_id", "entity_type", "entity_id")
    WHERE "status" = 'OPEN' AND "entity_id" IS NOT NULL;

ALTER TABLE "entity_drafts" ADD CONSTRAINT "entity_drafts_status_check"
    CHECK ("status" IN ('OPEN', 'PUBLISHED', 'DISCARDED'));

-- ---------------------------------------------------------------------------
-- Change approvals. Writes by non-approvers park here; deciders apply/reject.
-- Decided rows are kept as an audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE "change_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "change_requests_client_id_status_requested_at_idx"
    ON "change_requests"("client_id", "status", "requested_at");
CREATE INDEX "change_requests_client_id_entity_type_entity_id_idx"
    ON "change_requests"("client_id", "entity_type", "entity_id");

ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_action_check"
    CHECK ("action" IN ('CREATE', 'UPDATE', 'DELETE'));
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_status_check"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
