-- CreateTable: per-product stock for the seeded unit.
CREATE TABLE "inventory" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- One inventory row per product.
CREATE UNIQUE INDEX "inventory_product_id_key" ON "inventory"("product_id");

-- DB-enforced no-oversell invariant: the database itself rejects negative stock,
-- so PGlite and real Postgres behave identically under any concurrency.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_non_negative" CHECK ("quantity" >= 0);

-- FK to products; stock is removed with its product.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
