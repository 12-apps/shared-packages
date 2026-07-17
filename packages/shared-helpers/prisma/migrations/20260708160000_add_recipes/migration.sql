-- FUT-84: recipes / bills of materials.
--
-- A producible product's recipe: the component products (and quantities) that
-- registering "produção" of it consumes from stock. One recipe per product.

CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recipes_product_id_key" ON "recipes"("product_id");
CREATE INDEX "recipes_client_id_idx" ON "recipes"("client_id");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "recipe_components" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "component_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,

    CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_quantity_positive"
  CHECK ("quantity" > 0);

CREATE UNIQUE INDEX "recipe_components_recipe_id_component_product_id_key"
  ON "recipe_components"("recipe_id", "component_product_id");
CREATE INDEX "recipe_components_component_product_id_idx"
  ON "recipe_components"("component_product_id");

ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_component_product_id_fkey"
  FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
