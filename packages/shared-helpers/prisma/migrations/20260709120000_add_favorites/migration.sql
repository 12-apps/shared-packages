-- FUT-96: favorites (per-user record pins surfaced on the dashboard home).
--
-- A `Favorite` is one user's pin of a single admin record (a product, supplier,
-- or category). Ownership is per user; every read/write is tenant-scoped by
-- `client_id`. `scope` is a String + DB CHECK (PRODUCTS | SUPPLIERS | CATEGORIES),
-- the same String+CHECK pattern used elsewhere rather than a Postgres enum.
-- `label` snapshots the record's display name at favorite time. The owner FK is
-- scalar-linked to the user (no Prisma back-relation) and cascades on delete.

CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "favorites" ADD CONSTRAINT "favorites_scope_valid"
  CHECK ("scope" IN ('PRODUCTS', 'SUPPLIERS', 'CATEGORIES'));

-- A record is favorited at most once per (tenant, user, scope) — the constraint
-- that makes a repeat add idempotent (Prisma P2002).
CREATE UNIQUE INDEX "favorites_client_id_user_id_scope_record_id_key"
  ON "favorites"("client_id", "user_id", "scope", "record_id");

-- Dashboard lists a user's own favorites per tenant. Existence checks on the
-- full owner+scope+record tuple are served by the unique index above (a Postgres
-- unique constraint is backed by a B-tree), so no separate index is needed.
CREATE INDEX "favorites_client_id_user_id_idx"
  ON "favorites"("client_id", "user_id");

-- Tenant FK: a favorite is removed if its tenant is deleted.
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner FK: scalar-linked to the owning user (no Prisma back-relation); removed
-- if that user is deleted.
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
