-- FUT-67: make a product's SKU unique within its tenant.
--
-- `sku` is nullable and Postgres treats NULLs as distinct, so any number of
-- products may have no SKU; the constraint only bites once a value is set.
--
-- Self-heal first: prior to this migration nothing enforced SKU uniqueness, so an
-- existing tenant could have assigned the same non-null SKU to two products. Left
-- as-is, CREATE UNIQUE INDEX would abort the whole deploy with a unique_violation.
-- Keep the earliest product's SKU (by created_at, then id) and NULL out the later
-- duplicates so the operator can re-assign them. No-op on a fresh DB (no rows).
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "client_id", "sku" ORDER BY "created_at", "id"
    ) AS rn
  FROM "products"
  WHERE "sku" IS NOT NULL
)
UPDATE "products" AS p
SET "sku" = NULL
FROM ranked
WHERE p."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX "products_client_id_sku_key" ON "products"("client_id", "sku");
