-- FUT-168: accent/case-insensitive search key. `search_name` mirrors
-- normalizeSearchText(name) — lowercased, diacritics stripped — so "sabao"
-- matches "Sabão". Kept in sync on writes by the Prisma audit extension; this
-- migration adds the column and backfills existing rows.
--
-- The backfill strips accents in pure SQL via translate() (no `unaccent`
-- extension, which PGlite lacks) so it runs identically on PostgreSQL + PGlite.

ALTER TABLE "products" ADD COLUMN "search_name" TEXT;
ALTER TABLE "product_categories" ADD COLUMN "search_name" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "search_name" TEXT;

-- Lowercase first, then map the common Portuguese accented letters to their base
-- form. `from` and `to` are equal length, character for character.
UPDATE "products"
  SET "search_name" = translate(
    lower("name"),
    'áàâãäçéèêëíìîïóòôõöúùûüýÿñ',
    'aaaaaceeeeiiiiooooouuuuyyn'
  );

UPDATE "product_categories"
  SET "search_name" = translate(
    lower("name"),
    'áàâãäçéèêëíìîïóòôõöúùûüýÿñ',
    'aaaaaceeeeiiiiooooouuuuyyn'
  );

UPDATE "suppliers"
  SET "search_name" = translate(
    lower("name"),
    'áàâãäçéèêëíìîïóòôõöúùûüýÿñ',
    'aaaaaceeeeiiiiooooouuuuyyn'
  );

-- Support the prefix/substring lookups the palette runs per tenant.
CREATE INDEX "products_client_id_search_name_idx" ON "products"("client_id", "search_name");
CREATE INDEX "product_categories_client_id_search_name_idx" ON "product_categories"("client_id", "search_name");
CREATE INDEX "suppliers_client_id_search_name_idx" ON "suppliers"("client_id", "search_name");
