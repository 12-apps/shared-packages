-- FUT-491: an offer can now carry "this price is the store's DEFAULT region's".
--
-- A VTEX store that does not deliver to the researched CEP used to answer with
-- nothing (FUT-416). It now answers with its default-region catalog, flagged —
-- information beats silence, as long as the caveat travels with the price. The
-- flag has to survive the re-read, the cached run and the offers API, so it is
-- a real column: `raw` is the VERBATIM connector payload kept for offline
-- replay and must not carry fields of ours.
--
-- NOT NULL DEFAULT false: every offer written before this change was priced for
-- the buyer's own region (the only arms that produced offers were "served" and
-- "no regional knowledge"), so false is the truthful backfill rather than a
-- placeholder. IF NOT EXISTS keeps the replay idempotent for suites that apply
-- every migration into a fresh database.
ALTER TABLE "supplier_offers"
    ADD COLUMN IF NOT EXISTS "outside_delivery_area" BOOLEAN NOT NULL DEFAULT false;
