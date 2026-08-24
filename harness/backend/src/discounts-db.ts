/**
 * The `DiscountStore` seam, backed by a REAL Postgres (PGlite).
 *
 * The same arrangement `rbac-db.ts` and `saved-report-db.ts` give their
 * surfaces, on the three tables `@12-apps/discounts` ships — created by the
 * PACKAGE'S OWN migration, applied out of the installed tarball, so nothing
 * here restates the schema: a column the package adds arrives with its
 * migration, and a column it drops takes this file's SQL down with it, loudly.
 *
 * `DiscountStore` is declared structurally so a host can fill it with Prisma.
 * Prisma is what a real host passes; hand-written SQL is what this harness
 * passes, and the point of the seam is that the routes cannot tell.
 *
 * ## What the package hands over already folded
 *
 * A store here is much smaller than it looks, and deliberately: every rule has
 * already run by the time a write arrives. `toDiscountScalars` has forced the
 * unused half of each either/or pair to NULL, `targetsForScope` has narrowed
 * the targets to the scope, and `toTargetRows` turns the two id arrays and the
 * combo requirements into the exact rows these tables hold. So this file
 * persists columns and rows; it decides nothing about what a discount means.
 *
 * That asymmetry is the adoption's whole claim, and writing the store by hand
 * is how it gets tested — a port that could only be satisfied by re-deriving
 * the package's rules would be a defect in the package rather than a note in
 * its README.
 *
 * ## Live rows only
 *
 * Every read filters `archived_at IS NULL`, because `DiscountStore` documents
 * `get` as returning null for an archived row and `archive` as the delete path.
 * The origin host gets that filtering from a client extension it applies
 * globally; a host without one writes the predicate, which is what makes it
 * worth writing here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import type {
  DiscountListInput,
  DiscountPage,
  DiscountRecord,
  DiscountStore,
  DiscountWrite,
} from '@12-apps/discounts/server';
import { fromTargetRows, toTargetRows } from '@12-apps/discounts/server';

/**
 * The package's migrations, located by PATH inside the installed package.
 *
 * The same idiom every other seam here uses: these are shipped ASSETS rather
 * than module entry points, the package exports no path to them, and
 * `require.resolve` against one throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/discounts/prisma/migrations/', import.meta.url),
);

/**
 * Apply the published migrations, in name order — as a host deploy would.
 *
 * The package's migration is REPLAY-SAFE by construction: it ADOPTS an
 * existing `discounts` table rather than demanding a baseline, because the
 * first host to adopt this package already had one. So applying it over a
 * database that already satisfies it is a no-op, which is what makes calling
 * this from a reset path safe.
 */
export async function applyDiscountMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** The tenant every harness page and spec drives. */
export const DISCOUNTS_TENANT_ID = 'harness';

/** A second tenant, so isolation is provable at the tarball level. */
export const DISCOUNTS_TENANT_B_ID = 'harness-b';

/** One row of `discounts`, as Postgres returns it. */
interface DiscountRow {
  id: string;
  name: string;
  type: string;
  percent_off_bp: number | null;
  amount_off_cents: number | null;
  bundle_price_cents: number | null;
  free_units: number | null;
  max_combo_applications: number | null;
  scope: string;
  trigger: string;
  code: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  min_subtotal_cents: number | null;
  usage_limit: number | null;
  per_buyer_limit: number | null;
  usage_count: number;
  stackable: boolean;
  active: boolean;
  created_at: Date;
}

interface TargetRow {
  discount_id: string;
  target_type: string;
  target_id: string;
  slot_id: string | null;
}

interface SlotRow {
  id: string;
  discount_id: string;
  position: number;
  quantity: number;
}

/** `pg.query` with the rows typed, so every call site says what it expects. */
async function rows<T>(pg: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pg.query<T>(sql, params);
  return result.rows;
}

/**
 * The sortable columns, as an ALLOWLIST rather than an interpolation.
 *
 * `sort.field` reaches this file having been validated against the package's
 * own `discountSearchConfig`, so it is already one of these — but the value
 * still ends up inside SQL text, which no amount of upstream validation makes
 * safe to assume forever. A field the package adds and this map does not know
 * falls back to `created_at` rather than injecting.
 */
const SORT_COLUMNS: Record<string, string> = {
  name: 'name',
  createdAt: 'created_at',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  usageCount: 'usage_count',
};

/**
 * The one filter the package cannot own, applied here (FUT-244).
 *
 * `window` compares two nullable date columns against "now", which no
 * `filterableField` can express — so a host that wants the pill extends the
 * advertised query schema and reads its own key back out in its store. Doing
 * that here is what proves the extension seam works from a consumer's side;
 * the VALUES are the package's stable English tokens, never a host's words.
 */
function windowPredicate(value: unknown, params: unknown[]): string | null {
  if (value !== 'RUNNING' && value !== 'SCHEDULED' && value !== 'ENDED') return null;
  const now = new Date();
  if (value === 'RUNNING') {
    params.push(now, now);
    return `(starts_at IS NULL OR starts_at <= $${params.length - 1}) AND (ends_at IS NULL OR ends_at >= $${params.length})`;
  }
  params.push(now);
  return value === 'SCHEDULED'
    ? `starts_at IS NOT NULL AND starts_at > $${params.length}`
    : `ends_at IS NOT NULL AND ends_at < $${params.length}`;
}

/** Load the targets and combo slots for a set of discounts, in one pair of reads. */
async function targetsFor(
  pg: PGlite,
  ids: string[],
): Promise<Map<string, ReturnType<typeof fromTargetRows>>> {
  const empty = new Map<string, ReturnType<typeof fromTargetRows>>();
  if (ids.length === 0) return empty;
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const targetRows = await rows<TargetRow>(
    pg,
    `SELECT discount_id, target_type, target_id, slot_id
       FROM discount_targets WHERE discount_id IN (${placeholders})`,
    ids,
  );
  const slotRows = await rows<SlotRow>(
    pg,
    `SELECT id, discount_id, position, quantity
       FROM discount_combo_slots WHERE discount_id IN (${placeholders})`,
    ids,
  );

  for (const id of ids) {
    const mine = targetRows.filter((row) => row.discount_id === id);
    const slots = slotRows.filter((row) => row.discount_id === id);
    empty.set(
      id,
      fromTargetRows({
        // A scope target is one with no slot; a combo target belongs to a slot.
        scopeTargets: mine
          .filter((row) => row.slot_id === null)
          .map((row) => ({ targetType: row.target_type as 'CATEGORY' | 'ITEM', targetId: row.target_id })),
        comboSlots: slots.map((slot) => ({
          position: slot.position,
          quantity: slot.quantity,
          targets: mine
            .filter((row) => row.slot_id === slot.id)
            .map((row) => ({
              targetType: row.target_type as 'CATEGORY' | 'ITEM',
              targetId: row.target_id,
            })),
        })),
      }),
    );
  }
  return empty;
}

/** A row plus its targets, as the package's record. */
function toRecord(row: DiscountRow, targets: ReturnType<typeof fromTargetRows>): DiscountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    percentOffBp: row.percent_off_bp,
    amountOffCents: row.amount_off_cents,
    scope: row.scope,
    trigger: row.trigger,
    code: row.code,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minSubtotalCents: row.min_subtotal_cents,
    usageLimit: row.usage_limit,
    perBuyerLimit: row.per_buyer_limit,
    usageCount: row.usage_count,
    stackable: row.stackable,
    active: row.active,
    categoryIds: targets.categoryIds,
    menuItemIds: targets.menuItemIds,
    bundlePriceCents: row.bundle_price_cents,
    freeUnits: row.free_units,
    maxComboApplications: row.max_combo_applications,
    comboRequirements: targets.comboRequirements,
    createdAt: row.created_at,
  };
}

/** Replace a discount's targets and slots — the shape every write persists. */
async function writeTargets(pg: PGlite, id: string, write: DiscountWrite): Promise<void> {
  await pg.query('DELETE FROM discount_targets WHERE discount_id = $1', [id]);
  await pg.query('DELETE FROM discount_combo_slots WHERE discount_id = $1', [id]);

  const target = toTargetRows(write.targets);
  for (const row of target.scopeTargets) {
    await pg.query(
      `INSERT INTO discount_targets (id, discount_id, target_type, target_id)
         VALUES (gen_random_uuid(), $1, $2, $3)`,
      [id, row.targetType, row.targetId],
    );
  }
  for (const slot of target.comboSlots) {
    const [created] = await rows<{ id: string }>(
      pg,
      `INSERT INTO discount_combo_slots (id, discount_id, position, quantity)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [id, slot.position, slot.quantity],
    );
    if (!created) throw new Error('discount_combo_slots insert returned no id');
    for (const row of slot.targets) {
      await pg.query(
        `INSERT INTO discount_targets (id, discount_id, target_type, target_id, slot_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [id, row.targetType, row.targetId, created.id],
      );
    }
  }
}

/** The columns a write sets, in the order both statements below use them. */
function scalarValues(write: DiscountWrite): unknown[] {
  const s = write.scalars;
  return [
    s.name,
    s.type,
    s.percentOffBp,
    s.amountOffCents,
    s.bundlePriceCents,
    s.freeUnits,
    s.maxComboApplications,
    s.scope,
    s.trigger,
    s.code,
    s.startsAt,
    s.endsAt,
    s.minSubtotalCents,
    s.usageLimit,
    s.perBuyerLimit,
    s.stackable,
    s.active,
  ];
}

/** The seam a real host fills with Prisma, filled here with SQL over PGlite. */
export function discountStore(pg: PGlite): DiscountStore {
  async function get(clientId: string, id: string): Promise<DiscountRecord | null> {
    const [row] = await rows<DiscountRow>(
      pg,
      `SELECT * FROM discounts
         WHERE client_id = $1 AND id = $2 AND archived_at IS NULL`,
      [clientId, id],
    );
    if (!row) return null;
    const targets = await targetsFor(pg, [row.id]);
    return toRecord(row, targets.get(row.id) ?? fromTargetRows({ scopeTargets: [], comboSlots: [] }));
  }

  return {
    async list(clientId: string, input: DiscountListInput): Promise<DiscountPage> {
      const params: unknown[] = [clientId];
      const where = ['client_id = $1', 'archived_at IS NULL'];

      if (typeof input.q === 'string' && input.q.trim() !== '') {
        params.push(`%${input.q.trim()}%`);
        // ILIKE, because the package's config declares the `q` match
        // case-insensitive and PGlite is a real Postgres.
        where.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
      }
      const window = windowPredicate(input.window, params);
      if (window) where.push(`(${window})`);

      const clause = where.join(' AND ');
      const [counted] = await rows<{ total: string }>(
        pg,
        `SELECT COUNT(*)::text AS total FROM discounts WHERE ${clause}`,
        params,
      );
      const total = Number(counted?.total ?? 0);

      const column = SORT_COLUMNS[input.sort.field] ?? 'created_at';
      const direction = input.sort.direction === 'asc' ? 'ASC' : 'DESC';
      const offset = (input.page - 1) * input.pageSize;
      const page = await rows<DiscountRow>(
        pg,
        `SELECT * FROM discounts WHERE ${clause}
           ORDER BY ${column} ${direction}, id ASC
           LIMIT ${input.pageSize} OFFSET ${offset}`,
        params,
      );
      const targets = await targetsFor(pg, page.map((row) => row.id));
      const pageCount = Math.max(1, Math.ceil(total / input.pageSize));

      return {
        data: page.map((row) =>
          toRecord(row, targets.get(row.id) ?? fromTargetRows({ scopeTargets: [], comboSlots: [] })),
        ),
        pagination: {
          total,
          page: input.page,
          pageSize: input.pageSize,
          pageCount,
          hasNextPage: input.page < pageCount,
          hasPreviousPage: input.page > 1,
        },
      };
    },

    get,

    async create(clientId: string, write: DiscountWrite): Promise<DiscountRecord> {
      const [created] = await rows<{ id: string }>(
        pg,
        `INSERT INTO discounts (
           id, client_id, name, type, percent_off_bp, amount_off_cents,
           bundle_price_cents, free_units, max_combo_applications,
           scope, trigger, code, starts_at, ends_at, min_subtotal_cents,
           usage_limit, per_buyer_limit, stackable, active, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP
         ) RETURNING id`,
        [clientId, ...scalarValues(write)],
      );
      if (!created) throw new Error('discounts insert returned no id');
      await writeTargets(pg, created.id, write);
      const record = await get(clientId, created.id);
      if (!record) throw new Error('discounts insert did not read back');
      return record;
    },

    async update(clientId: string, id: string, write: DiscountWrite): Promise<void> {
      // Tenant-scoped, and the reason is the one on `DiscountStore` itself: a
      // write that forgot its tenant would not leak a row, it would let one
      // store edit another store's prices.
      await pg.query(
        `UPDATE discounts SET
           name = $3, type = $4, percent_off_bp = $5, amount_off_cents = $6,
           bundle_price_cents = $7, free_units = $8, max_combo_applications = $9,
           scope = $10, trigger = $11, code = $12, starts_at = $13, ends_at = $14,
           min_subtotal_cents = $15, usage_limit = $16, per_buyer_limit = $17,
           stackable = $18, active = $19, updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2 AND archived_at IS NULL`,
        [clientId, id, ...scalarValues(write)],
      );
      await writeTargets(pg, id, write);
    },

    async archive(clientId: string, id: string): Promise<void> {
      // A SOFT delete: order history holds frozen snapshots that reference
      // these rows, so the catalog entry leaves the grid without the rule that
      // priced a past order disappearing underneath it.
      await pg.query(
        `UPDATE discounts SET archived_at = CURRENT_TIMESTAMP
           WHERE client_id = $1 AND id = $2 AND archived_at IS NULL`,
        [clientId, id],
      );
    },
  };
}
