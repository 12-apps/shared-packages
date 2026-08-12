-- FUT #405: research-to-buy core tables. Owned by @12-apps/product-research (this
-- migration reaches the host's migrations folder via sync-prisma-plugins).
-- Deliberately NO foreign key into host tables (self-contained package schema,
-- entity-lifecycle / payments-backend doctrine): the host repository layer
-- scopes every read/write by client_id, and the researched catalog item is
-- named by value via (catalog_ref_type, catalog_ref_id).

CREATE TABLE "price_sources" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_sources_type_check" CHECK (
        "type" IN ('VTEX', 'MERCADO_LIVRE', 'SERP', 'AMAZON', 'MANUAL')
    ),
    CONSTRAINT "price_sources_status_check" CHECK (
        "status" IN ('ACTIVE', 'DEGRADED')
    )
);

CREATE UNIQUE INDEX "price_sources_client_id_name_key" ON "price_sources"("client_id", "name");

CREATE INDEX "price_sources_client_id_enabled_idx" ON "price_sources"("client_id", "enabled");

CREATE TABLE "research_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "catalog_ref_type" TEXT,
    "catalog_ref_id" TEXT,
    "term" TEXT NOT NULL,
    "brand" TEXT,
    "ean" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "region" TEXT,
    "requested_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_requests_client_id_created_at_idx" ON "research_requests"("client_id", "created_at");

CREATE TABLE "research_runs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source_stats" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_runs_status_check" CHECK (
        "status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')
    ),
    CONSTRAINT "research_runs_request_id_fkey" FOREIGN KEY ("request_id")
        REFERENCES "research_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "research_runs_client_id_created_at_idx" ON "research_runs"("client_id", "created_at");

CREATE INDEX "research_runs_request_id_idx" ON "research_runs"("request_id");

CREATE TABLE "supplier_offers" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "source_id" TEXT,
    "source_type" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "image_url" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "price_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL DEFAULT 0,
    "pack_quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "availability" TEXT,
    "eta_days" INTEGER,
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,
    "raw" JSONB,
    "expires_at" TIMESTAMP(3),
    "purchased_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_offers_run_id_fkey" FOREIGN KEY ("run_id")
        REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_offers_source_id_fkey" FOREIGN KEY ("source_id")
        REFERENCES "price_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "supplier_offers_run_id_rank_idx" ON "supplier_offers"("run_id", "rank");

CREATE INDEX "supplier_offers_client_id_created_at_idx" ON "supplier_offers"("client_id", "created_at");

CREATE INDEX "supplier_offers_client_id_expires_at_idx" ON "supplier_offers"("client_id", "expires_at");
