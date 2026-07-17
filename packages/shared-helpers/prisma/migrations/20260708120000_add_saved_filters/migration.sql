-- FUT-79: shared-per-tenant saved table filters.
--
-- A named filter belongs to a tenant (client) and a table scope; `filter_state`
-- is opaque JSON ({ filters, sortBy }) serialized by the admin FilterableDataGrid.
-- Shared across the tenant's admins (no user column) by product decision.

CREATE TABLE "saved_filters" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter_state" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- Scope is a closed set (same String+CHECK house pattern as costing_method etc.).
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_scope_valid"
  CHECK ("scope" IN ('PRODUCTS', 'INVENTORY', 'SUPPLIERS'));

-- A name is unique within a (tenant, table); the same name can exist per scope.
CREATE UNIQUE INDEX "saved_filters_client_id_scope_name_key"
  ON "saved_filters"("client_id", "scope", "name");

CREATE INDEX "saved_filters_client_id_scope_idx"
  ON "saved_filters"("client_id", "scope");

ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
