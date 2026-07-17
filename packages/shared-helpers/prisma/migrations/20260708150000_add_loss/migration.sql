-- FUT-83: configurable loss reasons + a reports-ready loss-event ledger.

CREATE TABLE "loss_reasons" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'LOSS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_category_valid"
  CHECK ("category" IN ('WASTE', 'LOSS', 'SPOILAGE'));

CREATE UNIQUE INDEX "loss_reasons_client_id_name_key" ON "loss_reasons"("client_id", "name");
CREATE INDEX "loss_reasons_client_id_active_idx" ON "loss_reasons"("client_id", "active");

ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "loss_events" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "loss_reason_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loss_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "loss_events" ADD CONSTRAINT "loss_events_quantity_positive" CHECK ("quantity" > 0);

CREATE INDEX "loss_events_client_id_occurred_at_idx" ON "loss_events"("client_id", "occurred_at");
CREATE INDEX "loss_events_loss_reason_id_idx" ON "loss_events"("loss_reason_id");

ALTER TABLE "loss_events" ADD CONSTRAINT "loss_events_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loss_events" ADD CONSTRAINT "loss_events_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loss_events" ADD CONSTRAINT "loss_events_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loss_events" ADD CONSTRAINT "loss_events_loss_reason_id_fkey"
  FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
