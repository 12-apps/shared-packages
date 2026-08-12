-- Named, time-bounded claims on the scheduled sweeps (FUT-343).
--
-- One row per sweep. The claim is a conditional UPDATE on `expires_at`, so the
-- database picks the winner between racing workers; `expires_at` also makes a
-- crashed holder recoverable with no operator action.
CREATE TABLE IF NOT EXISTS "sweep_leases" (
    "name"        TEXT NOT NULL,
    "holder"      TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sweep_leases_pkey" PRIMARY KEY ("name")
);
