-- Inventory cost-accounting (FUT-5 chain + cost/expiry lots).
--
-- Adds per-lot purchase/production tracking (cost paid + expiry) as the basis for
-- profit margin / markup / gain / loss, plus an append-only stock ledger. The
-- existing `inventory.quantity` stays the availability aggregate; the new tables
-- carry the cost + audit truth. All money is integer cents. Enums are String +
-- DB CHECK (the house pattern — no Prisma enums).

-- Low-stock threshold for the admin badge (quantity <= threshold).
ALTER TABLE "inventory" ADD COLUMN "low_stock_threshold" INTEGER NOT NULL DEFAULT 0;

-- Per-tenant COGS method, selectable in admin settings.
ALTER TABLE "clients" ADD COLUMN "costing_method" TEXT NOT NULL DEFAULT 'FIFO';
ALTER TABLE "clients" ADD CONSTRAINT "clients_costing_method_valid"
  CHECK ("costing_method" IN ('FIFO', 'FEFO', 'WEIGHTED_AVERAGE'));

-- COGS snapshot per sold line (nullable => safe on existing paid orders, no backfill).
ALTER TABLE "order_items" ADD COLUMN "cost_cents" INTEGER;

-- CreateTable: purchase/production lots (cost + expiry truth).
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PURCHASE',
    "quantity_received" INTEGER NOT NULL,
    "quantity_remaining" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "total_cost_cents" INTEGER NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "supplier" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- Lot invariants — the DB rejects impossible lots regardless of app concurrency.
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_source_valid"
  CHECK ("source" IN ('PURCHASE', 'PRODUCTION', 'ADJUSTMENT'));
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_quantity_received_positive"
  CHECK ("quantity_received" > 0);
-- The race-safe no-oversell backstop (mirrors inventory_quantity_non_negative).
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_quantity_remaining_non_negative"
  CHECK ("quantity_remaining" >= 0 AND "quantity_remaining" <= "quantity_received");
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_unit_cost_non_negative"
  CHECK ("unit_cost_cents" >= 0);
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_total_cost_non_negative"
  CHECK ("total_cost_cents" >= 0);

CREATE INDEX "stock_lots_client_id_idx" ON "stock_lots"("client_id");
CREATE INDEX "stock_lots_product_id_idx" ON "stock_lots"("product_id");
-- FEFO consumption order + soonest-expiry lookups.
CREATE INDEX "stock_lots_product_id_expiry_date_idx" ON "stock_lots"("product_id", "expiry_date");

ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: back every pre-existing stocked product with an opening (cost-unknown)
-- ADJUSTMENT lot, so the `inventory.quantity == SUM(lot.quantity_remaining)`
-- invariant holds for data created before cost tracking existed. Without this,
-- FEFO/FIFO consumption would falsely report a shortage on legacy stock. Keyed on
-- `product_id || '-opening'` (the same deterministic id the seed uses), so a
-- later re-seed re-syncs this row instead of creating a duplicate lot. Fresh DBs
-- have no inventory rows yet, so this inserts nothing there.
INSERT INTO "stock_lots" (
  "id", "client_id", "product_id", "source",
  "quantity_received", "quantity_remaining",
  "unit_cost_cents", "total_cost_cents",
  "purchase_date", "created_at", "updated_at"
)
SELECT
  p."id" || '-opening', p."client_id", i."product_id", 'ADJUSTMENT',
  i."quantity", i."quantity",
  0, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "inventory" i
JOIN "products" p ON p."id" = i."product_id"
WHERE i."quantity" > 0;

-- CreateTable: append-only stock ledger (audit + COGS lines).
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "type" TEXT NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "cost_cents" INTEGER,
    "order_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_valid"
  CHECK ("type" IN ('RESTOCK', 'SALE', 'ADJUST', 'SPOILAGE'));

CREATE INDEX "stock_movements_client_id_idx" ON "stock_movements"("client_id");
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
