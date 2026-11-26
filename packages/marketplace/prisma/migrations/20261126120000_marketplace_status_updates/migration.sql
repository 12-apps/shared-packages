-- @domains: marketplace
-- @12-apps/marketplace: following and informing a pedido's status (FUT-4653).
-- Additive and replay-safe, like the engine's earlier migrations: one new
-- column with a default, one new table with its CHECKs and indexes. No foreign
-- key into a host table, and nothing the previous release reads is changed.
--
-- `follow_status` is the connection's switch for the INBOUND move: ON for every
-- existing connection and every new one.
--
-- `marketplace_status_updates` holds one row per (order, step): the claim that
-- keeps a step from ever being sent twice, the marker an inbound echo is
-- recognised by, and the note of what the marketplace itself announced.
-- `claim_key` says WHICH run holds a SENDING claim, so two jobs for one step
-- never both call the marketplace.

ALTER TABLE "marketplace_integrations" ADD COLUMN IF NOT EXISTS "follow_status" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "marketplace_status_updates" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "claim_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_status_updates_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "marketplace_status_updates" ADD CONSTRAINT "marketplace_status_updates_provider_shape"
        CHECK ("provider" ~ '^[A-Z][A-Z0-9_]*$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_status_updates" ADD CONSTRAINT "marketplace_status_updates_step_check"
        CHECK ("step" IN ('READY', 'DISPATCHED', 'HANDED_OVER', 'CONCLUDED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_status_updates" ADD CONSTRAINT "marketplace_status_updates_source_check"
        CHECK ("source" IN ('STORE', 'MARKETPLACE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "marketplace_status_updates" ADD CONSTRAINT "marketplace_status_updates_state_check"
        CHECK ("state" IN ('SENDING', 'SENT', 'FAILED', 'NOTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per step of an order: the claim's unique.
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_status_updates_order_id_step_key"
    ON "marketplace_status_updates"("order_id", "step");

-- The outbound sweep reads only rows still SENDING.
CREATE INDEX IF NOT EXISTS "marketplace_status_updates_state_updated_at_idx"
    ON "marketplace_status_updates"("updated_at")
    WHERE "state" = 'SENDING';
