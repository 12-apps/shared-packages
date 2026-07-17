-- FUT-168: command-palette "Populares" source. Most-picked palette results per
-- tenant, incremented on each selection; `label` snapshotted at pick time so the
-- popular list renders without joining across products/suppliers/categories.
-- Deep-link targets are rebuilt from (entity_type, entity_id) client-side.

CREATE TABLE "admin_search_events" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_search_events_pkey" PRIMARY KEY ("id")
);

-- Entity type is a closed set (same String+CHECK house pattern as costing_method).
ALTER TABLE "admin_search_events" ADD CONSTRAINT "admin_search_events_entity_type_valid"
  CHECK ("entity_type" IN ('PRODUCT', 'SUPPLIER', 'CATEGORY'));

-- One counter row per (tenant, entity) — the upsert target for increments.
CREATE UNIQUE INDEX "admin_search_events_client_id_entity_type_entity_id_key"
  ON "admin_search_events"("client_id", "entity_type", "entity_id");

-- Serves the top-N popular query (ORDER BY count DESC within a tenant).
CREATE INDEX "admin_search_events_client_id_count_idx"
  ON "admin_search_events"("client_id", "count");

ALTER TABLE "admin_search_events" ADD CONSTRAINT "admin_search_events_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
