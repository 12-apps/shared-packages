-- FUT-148: denormalized per-(tenant, buyer) customer profile with spend
-- aggregates. A row exists once a buyer completes their first paid order at a
-- store; aggregates are rolled up on order completion (markOrderPaid). Keyed by
-- (client_id, user_id) so the same person at two stores has two INDEPENDENT
-- profiles — tenant isolation. Integer cents, snake_case, FKs cascade with the
-- owning tenant/user — matching the schema house style.
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "lifetime_spend_cents" INTEGER NOT NULL DEFAULT 0,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "average_spend_cents" INTEGER NOT NULL DEFAULT 0,
    "first_order_at" TIMESTAMP(3),
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- One profile per (buyer, tenant): makes the order-completion rollup an
-- idempotent upsert.
CREATE UNIQUE INDEX "customer_profiles_client_id_user_id_key"
  ON "customer_profiles"("client_id", "user_id");
-- The directory's default sorts: "top spenders" and "recent buyers" of tenant X.
CREATE INDEX "customer_profiles_client_id_lifetime_spend_cents_idx"
  ON "customer_profiles"("client_id", "lifetime_spend_cents");
CREATE INDEX "customer_profiles_client_id_last_order_at_idx"
  ON "customer_profiles"("client_id", "last_order_at");
CREATE INDEX "customer_profiles_user_id_idx" ON "customer_profiles"("user_id");

-- A profile is removed with its tenant or its buyer (LGPD: deleting the user
-- erases their per-store spend profiles too).
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing PAID orders, grouped per (tenant, buyer). Idempotent:
-- ON CONFLICT re-derives the aggregates from the same source, so re-running (e.g.
-- e2e provisioning after seeding orders) converges rather than double-counts.
-- Contact fields prefer the buyer's account values, else the latest order's.
INSERT INTO "customer_profiles" (
    "id", "client_id", "user_id", "name", "email", "phone",
    "lifetime_spend_cents", "visit_count", "average_spend_cents",
    "first_order_at", "last_order_at", "created_at", "updated_at"
)
SELECT
    (gen_random_uuid())::text,
    o."client_id",
    o."user_id",
    COALESCE(u."buyer_name", MAX(o."buyer_name")),
    u."email",
    COALESCE(u."phone", MAX(o."buyer_phone")),
    SUM(o."total_cents")::int,
    COUNT(*)::int,
    (SUM(o."total_cents") / COUNT(*))::int,
    MIN(o."created_at"),
    MAX(o."created_at"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "orders" o
JOIN "users" u ON u."id" = o."user_id"
WHERE o."status" = 'PAID'
GROUP BY o."client_id", o."user_id", u."email", u."buyer_name", u."phone"
ON CONFLICT ("client_id", "user_id") DO UPDATE SET
    "lifetime_spend_cents" = EXCLUDED."lifetime_spend_cents",
    "visit_count"          = EXCLUDED."visit_count",
    "average_spend_cents"  = EXCLUDED."average_spend_cents",
    "first_order_at"       = EXCLUDED."first_order_at",
    "last_order_at"        = EXCLUDED."last_order_at",
    "name"                 = EXCLUDED."name",
    "email"                = EXCLUDED."email",
    "phone"                = EXCLUDED."phone",
    "updated_at"           = CURRENT_TIMESTAMP;
