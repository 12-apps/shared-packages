/**
 * The ROW layer under `discounts-db.ts`: what the three tables hold, and the
 * translation between those rows and the package's own record.
 *
 * Split from the store so each file has one job. The store answers
 * `DiscountStore`'s six methods; this answers "what does a row look like, and
 * how does it become a `DiscountRecord`" — which is the part that moves when
 * the PACKAGE changes its schema, while the store moves when the PORT changes.
 * Keeping them apart means a migration that adds a column touches one file.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { DiscountRecord, DiscountWrite } from '@12-apps/discounts/server';
import { fromTargetRows, toTargetRows } from '@12-apps/discounts/server';

/** One row of `discounts`, as Postgres returns it. */
export interface DiscountRow {
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
export async function rows<T>(pg: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
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
export const SORT_COLUMNS: Record<string, string> = {
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
export function windowPredicate(value: unknown, params: unknown[]): string | null {
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
export async function targetsFor(
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
export function toRecord(row: DiscountRow, targets: ReturnType<typeof fromTargetRows>): DiscountRecord {
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
export async function writeTargets(pg: PGlite, id: string, write: DiscountWrite): Promise<void> {
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
    // 2D data, not a scan: a combo's slots each carry their own targets, and
    // both are bounded by the package's own CHECK constraints (a slot's
    // quantity is capped at 50, and a partial unique keeps a rule from naming
    // the same target twice under one slot). Indexing with a Map would not
    // remove the write per row, which is all this loop is.
    /* eslint-disable-next-line no-restricted-syntax -- bounded 2D write, see above */
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
export function scalarValues(write: DiscountWrite): unknown[] {
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

/** No targets at all — what a discount with none reads back as. */
export function emptyTargets(): ReturnType<typeof fromTargetRows> {
  return fromTargetRows({ scopeTargets: [], comboSlots: [] });
}
