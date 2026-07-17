-- Store address + coordinates for proximity discovery (FUT-113 "Perto de você").
-- Additive and replay-safe: the PGlite provisioner replays every committed
-- migration into an existing schema, so columns/index are guarded with
-- IF NOT EXISTS and the CHECK constraints with a DO block (ADD CONSTRAINT has
-- no IF NOT EXISTS form).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address_line" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "postal_code" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

-- Coordinate sanity — reject out-of-range writes at the DB layer. NULL stays
-- allowed: location is optional until the owner geocodes the store. The
-- existence checks scope conname to the clients relation (conrelid): constraint
-- names are only unique PER TABLE, so an unscoped lookup would let a same-named
-- constraint on any other table silently skip installing these CHECKs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_latitude_range' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_latitude_range"
      CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_longitude_range' AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_longitude_range"
      CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));
  END IF;
END $$;

-- Bounding-box prefilter for the Haversine nearby query (FUT-118): the btree
-- prunes on latitude/longitude ranges before any trig runs.
CREATE INDEX IF NOT EXISTS "clients_latitude_longitude_idx"
  ON "clients"("latitude", "longitude");
