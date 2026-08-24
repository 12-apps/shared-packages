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

import {
  emptyTargets,
  rows,
  SORT_COLUMNS,
  targetsFor,
  toRecord,
  scalarValues,
  windowPredicate,
  writeTargets,
  type DiscountRow,
} from './discounts-rows';

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

/**
 * One page of a tenant's live discounts.
 *
 * Lifted out of the store object because it is the only method with real work
 * in it — the filter clause, the count, the page and the target join are four
 * steps, where every other method is one statement and a read-back.
 */
async function listDiscounts(
  pg: PGlite,
  clientId: string,
  input: DiscountListInput,
): Promise<DiscountPage> {
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
    data: page.map((row) => toRecord(row, targets.get(row.id) ?? emptyTargets())),
    pagination: {
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount,
      hasNextPage: input.page < pageCount,
      hasPreviousPage: input.page > 1,
    },
  };
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
    return toRecord(row, targets.get(row.id) ?? emptyTargets());
  }

  return {
    list: (clientId, input) => listDiscounts(pg, clientId, input),

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
