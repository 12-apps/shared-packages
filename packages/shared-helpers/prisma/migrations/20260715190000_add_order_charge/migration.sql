-- Per-attempt PIX charge records (FUT-190). A reused AWAITING_PAYMENT order (FUT-179
-- de-dup) raises a new PagBank charge on every checkout retry; the order row only keeps
-- the LATEST provider_order_id, so a webhook for an earlier still-valid charge could not
-- resolve the order. One row per raised charge lets getOrderByProviderOrderId resolve an
-- order by ANY of its charges. provider_order_id is UNIQUE (also the idempotency key that
-- makes a duplicate insert a no-op).
CREATE TABLE "order_charges" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_charge_id" TEXT,
    "pix_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_charges_order_id_idx" ON "order_charges"("order_id");
CREATE UNIQUE INDEX "order_charges_provider_order_id_key" ON "order_charges"("provider_order_id");

ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
