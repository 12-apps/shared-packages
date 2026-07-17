-- AlterTable: add a display-order column to product_categories so the storefront
-- menu can order categories/subcategories deterministically (not alphabetically).
-- NOT NULL with a default is safe on existing rows.
ALTER TABLE "product_categories" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
