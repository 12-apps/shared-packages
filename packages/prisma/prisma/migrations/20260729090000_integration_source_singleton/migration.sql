-- FUT-434: paid connectors are singleton integrations — at most ONE source row
-- per (tenant, type) for the credentialed types, each running on the tenant's
-- own API key. VTEX and MANUAL stay multi-instance, created by name.
--
-- Belt-and-braces order: any duplicates that slipped in while the create
-- dialog still offered these types are collapsed first (the OLDEST row wins —
-- deterministic, and its id is the one past runs reference; supplier_offers
-- survive via ON DELETE SET NULL), then the partial unique index makes the
-- invariant a database fact. Like the CHECK constraints, the partial index is
-- migration-only DDL the Prisma schema cannot express. PGlite-safe (plain DDL).

DELETE FROM "price_sources" AS dup
USING "price_sources" AS keeper
WHERE dup."type" IN ('SERP', 'AMAZON', 'MERCADO_LIVRE')
  AND keeper."client_id" = dup."client_id"
  AND keeper."type" = dup."type"
  AND (
    keeper."created_at" < dup."created_at"
    OR (keeper."created_at" = dup."created_at" AND keeper."id" < dup."id")
  );

CREATE UNIQUE INDEX "price_sources_client_id_integration_type_key"
    ON "price_sources"("client_id", "type")
    WHERE "type" IN ('SERP', 'AMAZON', 'MERCADO_LIVRE');
