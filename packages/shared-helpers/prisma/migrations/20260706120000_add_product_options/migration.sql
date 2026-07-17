-- FUT-74: customizable products — variations, optionals & extras.
--
-- Adds the product-customization graph and threads the chosen composition through
-- the cart + order lines. Conventions match the rest of the schema: integer cents,
-- String + DB CHECK (no Prisma enums), tenant `client_id` on every table, snake_case.
--
--   variations — each is ANOTHER product (own stock/price); the parent is
--                grouping-only and the customer must pick exactly one.
--   optionals  — free "select-one" label groups (no price, no stock).
--   extras     — paid add-ons, each ANOTHER product whose own stock is consumed.

-- ---------------------------------------------------------------------------
-- Column adds on existing tables
-- ---------------------------------------------------------------------------

-- A product that exists only as a variation-child or an extra sets listed=false:
-- real stock, never a standalone menu card. Default true keeps every existing
-- product on the menu.
ALTER TABLE "products" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT true;
-- Max TOTAL paid-extra portions per line ("até N opções"); NULL = unlimited.
ALTER TABLE "products" ADD COLUMN "max_extras" INTEGER;
ALTER TABLE "products" ADD CONSTRAINT "products_max_extras_positive"
  CHECK ("max_extras" IS NULL OR "max_extras" > 0);

-- Storefront config: show the per-line "observação" note field. Off by default.
ALTER TABLE "clients" ADD COLUMN "enable_order_notes" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- ProductVariation — parent (grouping) product → variant product (stock/price)
-- ---------------------------------------------------------------------------
CREATE TABLE "product_variations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "parent_product_id" TEXT NOT NULL,
    "variant_product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variations_pkey" PRIMARY KEY ("id")
);
-- A product is never a variation of itself.
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_not_self"
  CHECK ("parent_product_id" <> "variant_product_id");
CREATE UNIQUE INDEX "product_variations_parent_product_id_variant_product_id_key"
  ON "product_variations"("parent_product_id", "variant_product_id");
CREATE INDEX "product_variations_client_id_idx" ON "product_variations"("client_id");
CREATE INDEX "product_variations_variant_product_id_idx" ON "product_variations"("variant_product_id");
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_parent_product_id_fkey"
  FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_variant_product_id_fkey"
  FOREIGN KEY ("variant_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ProductOptionGroup / ProductOptionChoice — free "select-one" labels
-- ---------------------------------------------------------------------------
CREATE TABLE "product_option_groups" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_option_groups_client_id_idx" ON "product_option_groups"("client_id");
CREATE INDEX "product_option_groups_product_id_idx" ON "product_option_groups"("product_id");
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_option_choices" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_choices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_option_choices_client_id_idx" ON "product_option_choices"("client_id");
CREATE INDEX "product_option_choices_group_id_idx" ON "product_option_choices"("group_id");
ALTER TABLE "product_option_choices" ADD CONSTRAINT "product_option_choices_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_option_choices" ADD CONSTRAINT "product_option_choices_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "product_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ProductExtra — paid add-on (m:n between products)
-- ---------------------------------------------------------------------------
CREATE TABLE "product_extras" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "extra_product_id" TEXT NOT NULL,
    "price_cents_override" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_extras_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "product_extras" ADD CONSTRAINT "product_extras_price_override_non_negative"
  CHECK ("price_cents_override" IS NULL OR "price_cents_override" >= 0);
ALTER TABLE "product_extras" ADD CONSTRAINT "product_extras_not_self"
  CHECK ("product_id" <> "extra_product_id");
CREATE UNIQUE INDEX "product_extras_product_id_extra_product_id_key"
  ON "product_extras"("product_id", "extra_product_id");
CREATE INDEX "product_extras_client_id_idx" ON "product_extras"("client_id");
CREATE INDEX "product_extras_extra_product_id_idx" ON "product_extras"("extra_product_id");
ALTER TABLE "product_extras" ADD CONSTRAINT "product_extras_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_extras" ADD CONSTRAINT "product_extras_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_extras" ADD CONSTRAINT "product_extras_extra_product_id_fkey"
  FOREIGN KEY ("extra_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Cart line composition — Expand the unique key (cart_id, product_id) →
-- (cart_id, composition_hash) so different configs of one base product coexist.
-- ---------------------------------------------------------------------------
ALTER TABLE "cart_items" ADD COLUMN "variation_product_id" TEXT;
ALTER TABLE "cart_items" ADD COLUMN "composition_hash" TEXT;
ALTER TABLE "cart_items" ADD COLUMN "note" TEXT;

-- Backfill existing (all simple, un-composed) lines with the canonical signature
-- the app emits for a base-only product: "p:<id>;v:-;o:;x:". Pure string concat so
-- it behaves identically in Postgres and PGlite (no pgcrypto dependency).
UPDATE "cart_items"
SET "composition_hash" = 'p:' || "product_id" || ';v:-;o:;x:'
WHERE "composition_hash" IS NULL;

ALTER TABLE "cart_items" ALTER COLUMN "composition_hash" SET NOT NULL;

-- Swap the uniqueness lock to the composition signature.
DROP INDEX "cart_items_cart_id_product_id_key";
CREATE UNIQUE INDEX "cart_items_cart_id_composition_hash_key"
  ON "cart_items"("cart_id", "composition_hash");

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variation_product_id_fkey"
  FOREIGN KEY ("variation_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cart_item_options" (
    "id" TEXT NOT NULL,
    "cart_item_id" TEXT NOT NULL,
    "option_group_id" TEXT NOT NULL,
    "option_choice_id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "label_snapshot" TEXT NOT NULL,

    CONSTRAINT "cart_item_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cart_item_options_cart_item_id_idx" ON "cart_item_options"("cart_item_id");
ALTER TABLE "cart_item_options" ADD CONSTRAINT "cart_item_options_cart_item_id_fkey"
  FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cart_item_extras" (
    "id" TEXT NOT NULL,
    "cart_item_id" TEXT NOT NULL,
    "extra_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,

    CONSTRAINT "cart_item_extras_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "cart_item_extras" ADD CONSTRAINT "cart_item_extras_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "cart_item_extras" ADD CONSTRAINT "cart_item_extras_unit_price_non_negative"
  CHECK ("unit_price_cents" >= 0);
CREATE INDEX "cart_item_extras_cart_item_id_idx" ON "cart_item_extras"("cart_item_id");
CREATE INDEX "cart_item_extras_extra_product_id_idx" ON "cart_item_extras"("extra_product_id");
ALTER TABLE "cart_item_extras" ADD CONSTRAINT "cart_item_extras_cart_item_id_fkey"
  FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_item_extras" ADD CONSTRAINT "cart_item_extras_extra_product_id_fkey"
  FOREIGN KEY ("extra_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Order line snapshot — variation + note on the line; options/extras children.
-- ---------------------------------------------------------------------------
ALTER TABLE "order_items" ADD COLUMN "variation_product_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN "note" TEXT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variation_product_id_fkey"
  FOREIGN KEY ("variation_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "order_item_options" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "choice_label" TEXT NOT NULL,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_item_options_order_item_id_idx" ON "order_item_options"("order_item_id");
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "order_item_extras" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "extra_product_id" TEXT,
    "name_snapshot" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_cents" INTEGER,

    CONSTRAINT "order_item_extras_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_unit_price_non_negative"
  CHECK ("unit_price_cents" >= 0);
CREATE INDEX "order_item_extras_order_item_id_idx" ON "order_item_extras"("order_item_id");
CREATE INDEX "order_item_extras_extra_product_id_idx" ON "order_item_extras"("extra_product_id");
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_extra_product_id_fkey"
  FOREIGN KEY ("extra_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
