-- Report lifecycle & sharing (FUT-307): status (draft | published), visibility
-- (tenant | roles | private) and the role-id allowlist for visibility='roles'.
-- String + DB CHECK, the house style (no Prisma enums).
ALTER TABLE "saved_reports"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'tenant',
  ADD COLUMN "visibility_roles" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "saved_reports"
  ADD CONSTRAINT "saved_reports_status_check"
    CHECK ("status" IN ('draft', 'published'));
ALTER TABLE "saved_reports"
  ADD CONSTRAINT "saved_reports_visibility_check"
    CHECK ("visibility" IN ('tenant', 'roles', 'private'));

-- Every pre-lifecycle report is live today: backfill as published so nothing
-- disappears from any tenant's Relatórios area (new rows default to draft).
UPDATE "saved_reports" SET "status" = 'published';
