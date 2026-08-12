-- FUT-518: "the source never said what shipping costs" stops being spelled 0.
--
-- `shipping_cents` was NOT NULL DEFAULT 0, so an offer whose freight nobody
-- knew was stored — and RANKED — as free shipping. That is not a rare corner:
-- the SERP connector (Google Shopping) never states a shipping cost at all, so
-- every one of its offers competed on an understated total against Amazon
-- (which writes 0 only on a real free-shipping signal) and Mercado Livre
-- (which parses it). Cheapest-first then hands the recommendation to whichever
-- offer hid its freight best — the same understated-total failure as FUT-497.
--
-- After this: NULL = the source never stated a shipping cost, so `total_cents`
-- is a MINIMUM and every surface caveats it; 0 = the source stated FREE.
-- The DEFAULT goes too, deliberately: with two writers of this table
-- (`appendRunOffers` and `insertOffers`, both through `toOfferRow` in
-- apps/web/lib/repositories/research-store.ts) and no raw SQL insert anywhere,
-- the column is always stated explicitly. Keeping a default would let a future
-- writer that forgets the column silently re-introduce the phantom zero.
--
-- NO BACKFILL, AND THAT IS THE HONEST ANSWER. Every row written before this
-- migration holds 0, and 0 now means "the source stated free". Those rows are
-- indistinguishable from genuinely free-shipping ones — the information to tell
-- them apart was destroyed at write time and no query can recover it. They are
-- left as they are: historical runs keep reading as free shipping, which is
-- wrong for some of them, but rewriting them to NULL would be equally wrong for
-- the rest and would additionally erase the real free-shipping answers Amazon
-- and Mercado Livre did give. The distinction starts with the runs from here on.
--
-- Idempotent (IF EXISTS / DROP DEFAULT is a no-op when absent) so the replay
-- suites that apply every migration into a fresh database stay green.
ALTER TABLE "supplier_offers"
    ALTER COLUMN "shipping_cents" DROP NOT NULL;

ALTER TABLE "supplier_offers"
    ALTER COLUMN "shipping_cents" DROP DEFAULT;
