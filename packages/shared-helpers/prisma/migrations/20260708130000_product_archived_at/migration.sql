-- FUT-80: soft-delete for products.
--
-- A non-null `archived_at` hides a product from the admin catalog and the public
-- menu while preserving its COGS/order/stock history. Nullable, no default, so
-- the migration is a no-op on existing rows (all stay active).

ALTER TABLE "products" ADD COLUMN "archived_at" TIMESTAMP(3);

-- The catalog/menu queries filter `archived_at IS NULL`; index the live set.
CREATE INDEX "products_client_id_archived_at_idx"
  ON "products"("client_id", "archived_at");
