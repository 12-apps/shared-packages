-- @domains: fiscal
-- @12-apps/fiscal (FUT-4717): the blocks of a contingency series a host hands
-- to a holder (a register that may go offline) to sign on, and the ranges of
-- them voided at SEFAZ. A block is drawn from the series' ONE counter, so the
-- server's own contingency never numbers inside it. Additive only: two new
-- tables. `holder` is the host's opaque id, stored by value.

CREATE TABLE "fiscal_contingency_blocks" (
    "id"               TEXT NOT NULL,
    "owner_id"         TEXT NOT NULL,
    "issuing_point_id" TEXT NOT NULL,
    "issuer_cnpj"      TEXT NOT NULL,
    "environment"      TEXT NOT NULL,
    "model"            TEXT NOT NULL,
    "series"           INTEGER NOT NULL,
    "first_number"     INTEGER NOT NULL,
    "last_number"      INTEGER NOT NULL,
    "holder"           TEXT NOT NULL,
    "fate"             TEXT NOT NULL DEFAULT 'OPEN',
    "used_up_to"       INTEGER,
    "reserved_at"      TIMESTAMP(3) NOT NULL,
    "closed_at"        TIMESTAMP(3),
    -- Every number accounted for (a document, or voided): the gap job skips it.
    "settled_at"       TIMESTAMP(3),

    CONSTRAINT "fiscal_contingency_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_contingency_blocks_issuing_point_id_fkey"
      FOREIGN KEY ("issuing_point_id") REFERENCES "fiscal_issuing_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_contingency_blocks_environment_check" CHECK ("environment" IN ('homologacao', 'producao')),
    CONSTRAINT "fiscal_contingency_blocks_model_check" CHECK ("model" = 'NFCE'),
    CONSTRAINT "fiscal_contingency_blocks_fate_check" CHECK ("fate" IN ('OPEN', 'CLOSED', 'ABANDONED')),
    CONSTRAINT "fiscal_contingency_blocks_range_check"
      CHECK ("first_number" >= 1 AND "last_number" >= "first_number" AND "last_number" <= 999999999),
    -- What the holder said it used: from first - 1 (nothing) to the last number.
    CONSTRAINT "fiscal_contingency_blocks_used_up_to_check"
      CHECK ("used_up_to" IS NULL OR "used_up_to" BETWEEN "first_number" - 1 AND "last_number"),
    CONSTRAINT "fiscal_contingency_blocks_closed_check"
      CHECK (("fate" = 'OPEN') = ("closed_at" IS NULL))
);

-- A number belongs to at most one block: blocks are drawn from the series' counter.
CREATE UNIQUE INDEX "fiscal_contingency_blocks_first_key"
  ON "fiscal_contingency_blocks"("issuer_cnpj", "environment", "model", "series", "first_number");
CREATE INDEX "fiscal_contingency_blocks_owner_id_holder_idx" ON "fiscal_contingency_blocks"("owner_id", "holder");
CREATE INDEX "fiscal_contingency_blocks_issuing_point_id_idx" ON "fiscal_contingency_blocks"("issuing_point_id");

CREATE TABLE "fiscal_contingency_voids" (
    "id"            TEXT NOT NULL,
    "block_id"      TEXT NOT NULL,
    "first_number"  INTEGER NOT NULL,
    "last_number"   INTEGER NOT NULL,
    "protocol"      TEXT,
    "event_xml_key" TEXT,
    "voided_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_contingency_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_contingency_voids_block_id_fkey"
      FOREIGN KEY ("block_id") REFERENCES "fiscal_contingency_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_contingency_voids_range_check" CHECK ("last_number" >= "first_number")
);

-- A range is voided once.
CREATE UNIQUE INDEX "fiscal_contingency_voids_block_id_first_number_key"
  ON "fiscal_contingency_voids"("block_id", "first_number");
