-- FUT-134: fulfillment lifecycle for admin order management, SEPARATE from the
-- payment lifecycle ("status", which stays webhook-owned: AWAITING_PAYMENT →
-- PAID/FAILED/EXPIRED). Admins move a paid order through delivery or cancel it.
-- Stock re-entry on cancel is deliberately deferred to a follow-up story.
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" TEXT NOT NULL DEFAULT 'PENDING';

-- Status domain guard (String+CHECK house style, like Order.status).
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillment_status_valid"
  CHECK ("fulfillment_status" IN ('PENDING', 'DELIVERED', 'COMPLETED', 'CANCELED'));

-- The new Pedidos grid ships saved views too — extend the scope domain.
ALTER TABLE "saved_filters" DROP CONSTRAINT "saved_filters_scope_valid";
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_scope_valid"
  CHECK ("scope" IN ('PRODUCTS', 'INVENTORY', 'SUPPLIERS', 'ORDERS'));
