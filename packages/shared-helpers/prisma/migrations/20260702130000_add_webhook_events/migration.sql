-- CreateTable: durable inbox for inbound provider webhooks (debuggable + retriable).
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pagbank',
    "external_id" TEXT NOT NULL,
    "product_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "headers" TEXT,
    "payload" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- Idempotency: a redelivery of the same event (same body hash) collapses here.
CREATE UNIQUE INDEX "webhook_events_external_id_key" ON "webhook_events"("external_id");
-- Serves the retry drain (find PENDING/FAILED).
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- DB-enforced status domain.
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_status_valid" CHECK ("status" IN ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED'));
