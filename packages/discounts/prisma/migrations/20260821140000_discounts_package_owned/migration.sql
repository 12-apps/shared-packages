-- @12-apps/discounts: the promotions tables, owned by the package and copied
-- into a host's migrations folder by its plugin-migration sync. Runs
-- identically on PostgreSQL and PGlite.
--
-- ── REPLAY-SAFE ON PURPOSE ────────────────────────────────────────────────
-- Every statement here is idempotent, because the first host to adopt this
-- package already HAS a `discounts` table created by its own, earlier
-- migration. A package migration is applied by name order, so this one sorts
-- AFTER the host's — and a bare `CREATE TABLE` would then fail
-- `prisma migrate deploy` on an existing database AND on a fresh one built from
-- the full folder. `prisma migrate resolve --applied` can only paper over the
-- first case, by hand, once per database. So this migration ADOPTS an existing
-- table instead of demanding a baseline:
--
--   * a fresh host gets the three tables, every index and every CHECK;
--   * a host that already has `discounts` gets only what it is missing — the
--     three combo columns, the two new tables, and the widened CHECKs;
--   * replaying the whole folder is a no-op.
--
-- What it deliberately does NOT do is MOVE a host's existing target rows. A
-- host adopting this package has `discount_categories` / `discount_items` rows
-- that belong in `discount_targets`, and only that host knows whether its
-- catalog tables are named what this package would have to guess. Backfilling
-- and dropping the old tables is one migration in the host, written once, and
-- it sorts after this one.
--
-- ── NO FOREIGN KEYS INTO HOST TABLES ──────────────────────────────────────
-- `client_id` and `target_id` are by-value scalars (the payments-backend
-- doctrine). The relations INTERNAL to these three tables ARE constrained, with
-- cascades, so a deleted rule can never leave orphan targets or orphan slots.
-- A host that wants referential integrity against its own catalog adds those
-- constraints in its own migration — and should first read the partial's note
-- on what the absence actually costs.

-- ─────────────────────────────────────────────────────────────────────────────
-- discounts — the rule itself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discounts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "percent_off_bp" INTEGER,
    "amount_off_cents" INTEGER,
    "bundle_price_cents" INTEGER,
    "free_units" INTEGER,
    "max_combo_applications" INTEGER,
    "scope" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "code" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "min_subtotal_cents" INTEGER,
    "usage_limit" INTEGER,
    "per_buyer_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "search_name" TEXT,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- The three combo columns, for a host whose `discounts` predates them.
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "bundle_price_cents" INTEGER;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "free_units" INTEGER;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "max_combo_applications" INTEGER;

-- One live name and one live coupon per tenant. PARTIAL on purpose: deleting is
-- a soft archive, and an unconditional unique lets a deleted coupon squat its
-- code forever, so the operator can never recreate a code they removed. NULLs
-- stay distinct, so the many automatic rules (all `code` NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "discounts_client_id_name_key"
    ON "discounts"("client_id", "name") WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "discounts_client_id_code_key"
    ON "discounts"("client_id", "code") WHERE "archived_at" IS NULL;

-- The storefront's "which rules could fire right now", and the admin list's
-- default active-first ordering.
CREATE INDEX IF NOT EXISTS "discounts_client_id_active_archived_at_idx"
    ON "discounts"("client_id", "active", "archived_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- discount_combo_slots — the quantified groups a COMBO matches.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discount_combo_slots" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    -- The operator's order, which is also the order a card describes the combo
    -- in. Stable because two slots of the same size are otherwise
    -- indistinguishable in a list.
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "discount_combo_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "discount_combo_slots_discount_id_position_key"
    ON "discount_combo_slots"("discount_id", "position");

-- ─────────────────────────────────────────────────────────────────────────────
-- discount_targets — what a rule points at, BY VALUE.
--
-- One table for both jobs, told apart by `slot_id`: NULL is a SCOPE target,
-- non-null is one combo slot's. They are the same fact — "this rule cares about
-- this row of this collection" — and two tables would need every reverse read,
-- every ownership check and every cascade written twice.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "discount_targets" (
    "id" TEXT NOT NULL,
    "discount_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,

    CONSTRAINT "discount_targets_pkey" PRIMARY KEY ("id")
);

-- PARTIAL uniques, and they have to be: NULLs are distinct in Postgres, so one
-- unconditional unique over `slot_id` would not constrain the scope rows at all
-- — a rule could name the same category twice and cover it twice.
CREATE UNIQUE INDEX IF NOT EXISTS "discount_targets_scope_key"
    ON "discount_targets"("discount_id", "target_type", "target_id")
    WHERE "slot_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "discount_targets_slot_key"
    ON "discount_targets"("slot_id", "target_type", "target_id")
    WHERE "slot_id" IS NOT NULL;

-- The reverse read a menu badge does: "which rules touch this row".
CREATE INDEX IF NOT EXISTS "discount_targets_target_type_target_id_idx"
    ON "discount_targets"("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "discount_targets_discount_id_idx"
    ON "discount_targets"("discount_id");
CREATE INDEX IF NOT EXISTS "discount_targets_slot_id_idx"
    ON "discount_targets"("slot_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- Foreign keys — INTERNAL only.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "discount_combo_slots" ADD CONSTRAINT "discount_combo_slots_discount_id_fkey"
        FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_discount_id_fkey"
        FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cascading from the SLOT as well as from the discount: removing one slot of a
-- combo must take its targets, or the next write would merge them into the slot
-- that replaced it.
DO $$ BEGIN
    ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_slot_id_fkey"
        FOREIGN KEY ("slot_id") REFERENCES "discount_combo_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK constraints — the String+CHECK house style. The closed sets here and
-- the arrays in `src/engine/kinds.ts` are two halves of ONE set: widening one
-- without the other is how a write starts failing at the database rather than
-- at the validator.
--
-- The three that a host may already have in a NARROWER form are dropped and
-- re-added rather than guarded, because the whole point is to widen them.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "discounts" DROP CONSTRAINT IF EXISTS "discounts_type_check";
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_type_check"
    CHECK ("type" IN ('PERCENTAGE', 'FIXED_AMOUNT', 'BUNDLE_PRICE', 'FREE_UNITS'));

ALTER TABLE "discounts" DROP CONSTRAINT IF EXISTS "discounts_scope_check";
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_scope_check"
    CHECK ("scope" IN ('ORDER', 'CATEGORY', 'ITEM', 'COMBO'));

-- Exactly one value column, chosen by the type. A percentage with no rate, or a
-- bundle with no price, would silently discount nothing.
ALTER TABLE "discounts" DROP CONSTRAINT IF EXISTS "discounts_value_check";
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check"
    CHECK (("type" = 'PERCENTAGE')   = ("percent_off_bp" IS NOT NULL)
       AND ("type" = 'FIXED_AMOUNT') = ("amount_off_cents" IS NOT NULL)
       AND ("type" = 'BUNDLE_PRICE') = ("bundle_price_cents" IS NOT NULL)
       AND ("type" = 'FREE_UNITS')   = ("free_units" IS NOT NULL));

-- A combo REWARD only means something against a matched group: "the group costs
-- R$ 25" and "one of them is free" are both statements ABOUT a group.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_combo_reward_scope_check"
        CHECK ("type" NOT IN ('BUNDLE_PRICE', 'FREE_UNITS') OR "scope" = 'COMBO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_bundle_price_check"
        CHECK ("bundle_price_cents" IS NULL OR "bundle_price_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_free_units_check"
        CHECK ("free_units" IS NULL OR "free_units" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A per-cart cap on a rule that is not a combo would be a number nothing reads.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_max_combo_applications_check"
        CHECK ("max_combo_applications" IS NULL
            OR ("max_combo_applications" > 0 AND "scope" = 'COMBO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_trigger_check"
        CHECK ("trigger" IN ('AUTOMATIC', 'CODE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 0 bp is not a promotion; over 100% would credit the buyer.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_percent_off_bp_check"
        CHECK ("percent_off_bp" IS NULL
            OR ("percent_off_bp" > 0 AND "percent_off_bp" <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_amount_off_cents_check"
        CHECK ("amount_off_cents" IS NULL OR "amount_off_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A CODE rule with no code can never be redeemed; an AUTOMATIC one with a code
-- would be redeemable two different ways.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_code_check"
        CHECK (("trigger" = 'CODE') = ("code" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An inverted window is always empty; whoever typed it meant something else.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_window_check"
        CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_min_subtotal_check"
        CHECK ("min_subtotal_cents" IS NULL OR "min_subtotal_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_usage_limit_check"
        CHECK ("usage_limit" IS NULL OR "usage_limit" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_per_buyer_limit_check"
        CHECK ("per_buyer_limit" IS NULL OR "per_buyer_limit" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_usage_count_check"
        CHECK ("usage_count" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The invariant the predicated PAID-time UPDATE exists to keep true.
DO $$ BEGIN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_usage_within_limit_check"
        CHECK ("usage_limit" IS NULL OR "usage_count" <= "usage_limit");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A slot asking for zero units can never be filled; the upper bound is
-- MAX_COMBO_SLOT_QUANTITY, and a combo nobody can carry is not an offer.
DO $$ BEGIN
    ALTER TABLE "discount_combo_slots" ADD CONSTRAINT "discount_combo_slots_quantity_check"
        CHECK ("quantity" > 0 AND "quantity" <= 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "discount_combo_slots" ADD CONSTRAINT "discount_combo_slots_position_check"
        CHECK ("position" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The closed set of discountable dimensions. Widening it is a host registering
-- one more DiscountableCollection, plus this line.
DO $$ BEGIN
    ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_target_type_check"
        CHECK ("target_type" IN ('CATEGORY', 'ITEM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
