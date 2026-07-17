-- Per-tenant membership join: (user, tenant, role). The row is what scopes a
-- user to a tenant; the User itself stays global/shared. `role` is a String
-- with a DB CHECK (OWNER | ADMIN | CUSTOMER), matching the house style.
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- One role per (user, tenant): makes "register on a tenant" an idempotent upsert.
CREATE UNIQUE INDEX "memberships_user_id_client_id_key" ON "memberships"("user_id", "client_id");
-- "list users/admins of tenant X" and "which tenants is user X in".
CREATE INDEX "memberships_client_id_idx" ON "memberships"("client_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- Role domain guard.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check"
  CHECK ("role" IN ('OWNER', 'ADMIN', 'CUSTOMER'));

-- FKs: a membership is removed with its user or its tenant.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing user gets one CUSTOMER membership on the oldest
-- tenant (deny-by-default). Guarded so it no-ops on an empty prod DB. The seed
-- separately upgrades ADMIN_EMAILS accounts to OWNER (migrations can't read env).
INSERT INTO "memberships" ("id", "user_id", "client_id", "role", "created_at", "updated_at")
SELECT (gen_random_uuid())::text, u."id",
       (SELECT "id" FROM "clients" ORDER BY "created_at" ASC LIMIT 1),
       'CUSTOMER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "clients");
