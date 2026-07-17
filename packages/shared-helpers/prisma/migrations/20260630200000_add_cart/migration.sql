-- CreateTable: anonymous storefront cart, scoped to the seeded client.
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one row per product in a cart.
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carts_client_id_idx" ON "carts"("client_id");
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");
-- Dedicated index on product_id so the products→cart_items ON DELETE CASCADE FK
-- (a product_id-only lookup) uses an index instead of a sequential scan; the
-- composite (cart_id, product_id) below can't serve a product_id-only probe.
CREATE INDEX "cart_items_product_id_idx" ON "cart_items"("product_id");

-- One line per product per cart: makes "add" an idempotent upsert/increment.
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_key" ON "cart_items"("cart_id", "product_id");

-- DB-enforced invariant: a persisted line always has a positive quantity
-- (removal deletes the row). PGlite and real Postgres reject violations alike.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0);

-- FKs: a cart belongs to a client; a line belongs to a cart and a product.
-- Deleting the client/cart/product cascades the dependent rows away.
ALTER TABLE "carts" ADD CONSTRAINT "carts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
