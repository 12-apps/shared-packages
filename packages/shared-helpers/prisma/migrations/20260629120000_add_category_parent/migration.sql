-- AlterTable: add an optional self-referential parent to product_categories so
-- categories can be nested. Nullable, so it is safe on existing rows.
ALTER TABLE "product_categories" ADD COLUMN "parent_id" TEXT;

-- CreateIndex
CREATE INDEX "product_categories_parent_id_idx" ON "product_categories"("parent_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
