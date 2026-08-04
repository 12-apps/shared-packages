-- Manual price import (FUT-415): the standing dataset behind MANUAL-type
-- price sources. Rows come from price-list imports or one-off typed quotes
-- and are read by the manual connector during research runs; `valid_until`
-- is the staleness horizon and `batch_id` groups one import so a re-import
-- replaces the previous list. PGlite-safe (plain DDL).

CREATE TABLE "manual_price_entries" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "ean" TEXT,
    "pack_quantity" INTEGER,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "url" TEXT,
    "availability" TEXT,
    "eta_days" INTEGER,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_price_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manual_price_entries_source_id_fkey" FOREIGN KEY ("source_id")
        REFERENCES "price_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "manual_price_entries_client_id_source_id_valid_until_idx"
    ON "manual_price_entries"("client_id", "source_id", "valid_until");
