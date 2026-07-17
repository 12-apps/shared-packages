-- FUT-87: upgrade the shared-per-tenant saved_filters into per-user SavedViews.
--
-- Ownership becomes per user (with a `shared` toggle that makes a view visible to
-- the whole tenant), and a view now also carries a description, pin/default flags,
-- and a richer `filter_state` ({ filters, sortBy, visibleColumns }). `saved_filters`
-- was introduced earlier on this same (unmerged) branch and holds only throwaway
-- dev data whose shape is changing, so existing rows are cleared before the NOT
-- NULL owner column is added.
DELETE FROM "saved_filters";

ALTER TABLE "saved_filters"
  ADD COLUMN "user_id" TEXT NOT NULL,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Ownership is per user; a view name is unique within a (tenant, user, table) so
-- two admins can each have their own "Low stock" view.
DROP INDEX "saved_filters_client_id_scope_name_key";
CREATE UNIQUE INDEX "saved_filters_client_id_user_id_scope_name_key"
  ON "saved_filters"("client_id", "user_id", "scope", "name");

-- Listing reads a user's own rows (and, separately, the tenant's shared rows) per
-- table; pin/default lookups filter by user too.
CREATE INDEX "saved_filters_client_id_user_id_scope_idx"
  ON "saved_filters"("client_id", "user_id", "scope");

-- Owner FK: a view is scalar-linked to its owning user (no Prisma back-relation),
-- and is removed if that user is deleted.
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
