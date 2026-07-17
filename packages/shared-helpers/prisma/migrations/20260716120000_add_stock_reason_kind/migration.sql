-- FUT-180: split stock-movement reasons into loss vs gain.
-- Existing rows are all losses, so the column defaults to 'LOSS' and backfills
-- every current row without a data migration.

ALTER TABLE "loss_reasons" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'LOSS';

ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_kind_valid"
  CHECK ("kind" IN ('LOSS', 'GAIN'));
