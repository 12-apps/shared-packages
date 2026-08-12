-- The "downgrade never deletes" anchor for retention quotas: one row per
-- (tenant, retention feature) recording when the CURRENT window took effect.
-- The retention sweep only prunes rows written after "since", so a shrinking
-- window never retroactively destroys history accumulated while the tenant
-- was entitled to keep it longer.
--
-- No foreign key into any host table on purpose (the payments doctrine):
-- tenant scoping is a plain client_id column, and the host repository layer
-- is the tenant boundary.
CREATE TABLE "retention_watermarks" (
    "client_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "window_days" INTEGER NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_watermarks_pkey" PRIMARY KEY ("client_id", "feature")
);
