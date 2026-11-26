-- @domains: marketplace
-- @12-apps/marketplace: a SKU may map to one variation of a catalog item (FUT-4927).
-- Additive and replay-safe, like the engine's earlier migrations: one nullable
-- column. No foreign key into a host table, and nothing the previous release
-- reads is changed: every existing link keeps `variation_id` NULL, which is
-- the parent-only mapping it already was.
--
-- `variation_id` is the host's id of the variation the SKU names, beside the
-- `menu_item_id` it belongs to. NULL maps the SKU to the parent item alone.

ALTER TABLE "marketplace_menu_links" ADD COLUMN IF NOT EXISTS "variation_id" TEXT;
