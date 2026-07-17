-- FUT-82: suppliers (fornecedores).
--
-- A tenant-scoped supplier a purchase can be attributed to. Adapted from a
-- Square-style vendor, trimmed to one primary contact + simple address. Adds a
-- nullable `supplier_id` FK on stock_lots (the legacy free-text `supplier` stays
-- for existing rows; prefer the FK when set).

CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "account_number" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_status_valid"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE'));

CREATE UNIQUE INDEX "suppliers_client_id_name_key" ON "suppliers"("client_id", "name");
CREATE INDEX "suppliers_client_id_status_idx" ON "suppliers"("client_id", "status");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Link a purchase lot to a supplier (optional; keeps the ledger if the supplier
-- is later removed).
ALTER TABLE "stock_lots" ADD COLUMN "supplier_id" TEXT;
CREATE INDEX "stock_lots_supplier_id_idx" ON "stock_lots"("supplier_id");
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
