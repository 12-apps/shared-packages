-- Multi-tenant: give each Client (tenant) a URL-safe `slug`, a `status`, and an
-- onboarding profile; drop the global-unique on `name`.
--
-- Expand -> backfill -> contract. Every backfill is guarded / idempotent so it
-- is a no-op on a fresh or empty production database (deploy runs
-- `prisma migrate deploy`, never the seed, so prod `clients` starts empty).

-- Expand: add `slug` nullable first, plus `status` and the nullable profile.
ALTER TABLE "clients" ADD COLUMN "slug" TEXT;
ALTER TABLE "clients" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "clients" ADD COLUMN "legal_name" TEXT;
ALTER TABLE "clients" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "clients" ADD COLUMN "contact_phone" TEXT;
ALTER TABLE "clients" ADD COLUMN "document_id" TEXT;
ALTER TABLE "clients" ADD COLUMN "onboarded_at" TIMESTAMP(3);

-- Backfill: derive a slug from the display name for any pre-existing tenant
-- (no-op on an empty table). Lowercase, collapse non-alphanumeric runs to a
-- single hyphen, then strip any leading/trailing hyphen the regex produced.
UPDATE "clients"
  SET "slug" = regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g')
  WHERE "slug" IS NULL;
UPDATE "clients"
  SET "slug" = trim(both '-' from "slug")
  WHERE "slug" IS NOT NULL;

-- Contract: enforce NOT NULL + uniqueness now that every row has a slug.
ALTER TABLE "clients" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- Status domain guard (String+CHECK house style, like Order/Inventory).
ALTER TABLE "clients" ADD CONSTRAINT "clients_status_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'PENDING'));

-- `name` is no longer globally unique (uniqueness is now per-tenant on the
-- catalog); two tenants may share a display name.
DROP INDEX "clients_name_key";
