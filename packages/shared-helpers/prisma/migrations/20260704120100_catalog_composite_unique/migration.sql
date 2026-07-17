-- Multi-tenant catalog uniqueness: product and category names are unique PER
-- TENANT `(client_id, name)` instead of globally, so two tenants can each have a
-- product/category with the same name. Safe to apply today — a single tenant
-- cannot collide with itself, so no data conflicts with the composite index.
DROP INDEX "products_name_key";
DROP INDEX "product_categories_name_key";
CREATE UNIQUE INDEX "products_client_id_name_key" ON "products"("client_id", "name");
CREATE UNIQUE INDEX "product_categories_client_id_name_key" ON "product_categories"("client_id", "name");
