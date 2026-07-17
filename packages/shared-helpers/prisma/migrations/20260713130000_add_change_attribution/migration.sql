-- FUT-168: change attribution on searchable admin records. `created_by` /
-- `updated_by` hold the admin `users.id` that created / last edited the row,
-- powering the command-palette "From me" / "Modificados por mim" filters and a
-- basic audit trail. Nullable + additive: existing rows and system writes stay
-- untracked (NULL). Scalar FKs (no ON DELETE cascade) — attribution survives a
-- user deletion as a dangling id, matching the SavedView user_id house pattern.

ALTER TABLE "products"
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT;

ALTER TABLE "product_categories"
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT;

ALTER TABLE "suppliers"
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT;
