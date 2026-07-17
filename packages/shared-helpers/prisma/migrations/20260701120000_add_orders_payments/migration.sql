-- CreateTable: a checkout order with a server-side price snapshot.
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "method" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "buyer_name" TEXT,
    "buyer_email" TEXT,
    "buyer_phone" TEXT,
    "provider_order_id" TEXT,
    "pix_copy_paste" TEXT,
    "pix_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: an order line with a snapshotted price + name (durable history).
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: a payment attempt; provider_charge_id is the idempotency key.
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_charge_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "raw_payload" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: a reusable card token saved against a user (no PAN, ever).
CREATE TABLE "saved_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_card_token" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "holder" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_cards_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "orders_client_id_idx" ON "orders"("client_id");
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX "saved_cards_user_id_idx" ON "saved_cards"("user_id");

-- The idempotency guarantee: one payment row per provider charge. A duplicate
-- webhook delivery collides on this unique index and is a DB-level no-op, not a
-- check-then-insert race (PGlite and real Postgres behave identically).
CREATE UNIQUE INDEX "payments_provider_charge_id_key" ON "payments"("provider_charge_id");

-- DB-enforced domain invariants (raw CHECKs — Prisma models can't express these).
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_cents_non_negative" CHECK ("total_cents" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("status" IN ('AWAITING_PAYMENT', 'PAID', 'FAILED', 'EXPIRED'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_method_valid" CHECK ("method" IN ('PIX', 'CARD'));
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_price_non_negative" CHECK ("unit_price_cents" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_cents_non_negative" CHECK ("amount_cents" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_valid" CHECK ("method" IN ('PIX', 'CARD'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_valid" CHECK ("status" IN ('PENDING', 'PAID', 'DECLINED'));

-- FKs. Orders belong to a client + user; deleting either cascades the order.
-- Order lines cascade with their order; product_id is SET NULL so deleting a
-- product preserves order history (the name/price are snapshotted on the line).
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
