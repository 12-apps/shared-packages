/**
 * The READ half of the `ShiftDb` seam, over whichever runner the caller holds.
 *
 * Split from `shift-db.ts` the way `rbac-db.ts` splits its delegates across
 * `rbac-db-roles.ts` and `rbac-db-team.ts`: the reads answer four questions
 * that share nothing but a table, and each carries the reasoning for its own
 * predicate. `queryOver` composes them into the object the seam wants — every
 * one is also reachable on its own, which is what a transaction needs (it holds
 * a different runner and reuses two of these verbatim).
 */
import type { Shift, ShiftListInput, ShiftPage } from '@12-apps/shift/types';
import { ShiftError } from '@12-apps/shift';

import {
  cursorPredicate,
  historyPredicate,
  HISTORY_ORDER,
  Params,
  SHIFT_COLUMNS,
  ShiftRow,
  toShift,
  type SqlRunner,
} from './shift-rows';

/** The default page size, matching the package's own driver. */
const DEFAULT_LIMIT = 20;

/** One shift of one client, by id. */
export async function getShift(
  sql: SqlRunner,
  clientId: string,
  shiftId: string,
): Promise<Shift | null> {
  const params = new Params();
  const { rows } = await sql.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shifts
     WHERE client_id = ${params.add(clientId)} AND id = ${params.add(shiftId)}`,
    params.values,
  );
  return rows[0] ? toShift(rows[0]) : null;
}

/** The one shift this person has open, if any — the partial unique index's pair. */
export async function getOpenShift(
  sql: SqlRunner,
  clientId: string,
  userId: string,
): Promise<Shift | null> {
  const params = new Params();
  const { rows } = await sql.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shifts
     WHERE client_id = ${params.add(clientId)} AND user_id = ${params.add(userId)}
       AND ended_at IS NULL`,
    params.values,
  );
  return rows[0] ? toShift(rows[0]) : null;
}

/** Who is on duty now, optionally narrowed to one kind of shift. */
export async function listOpenShifts(
  sql: SqlRunner,
  clientId: string,
  kind?: string,
): Promise<Shift[]> {
  const params = new Params();
  const where = [`client_id = ${params.add(clientId)}`, 'ended_at IS NULL'];
  if (kind !== undefined) where.push(`kind = ${params.add(kind)}`);
  const { rows } = await sql.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shifts WHERE ${where.join(' AND ')} ${HISTORY_ORDER}`,
    params.values,
  );
  return rows.map(toShift);
}

/** A page of history, newest first, by keyset. */
export async function listShifts(
  sql: SqlRunner,
  input: Required<Pick<ShiftListInput, 'clientId' | 'limit'>> &
    Omit<ShiftListInput, 'clientId' | 'limit'>,
): Promise<ShiftPage> {
  const params = new Params();
  const where = [historyPredicate(input, params)];

  if (input.cursor !== undefined) {
    // Resolve the cursor to its ordering key first. An id that is not in
    // this client's history is REJECTED rather than treated as "start from
    // the top" — the package's in-memory driver throws INVALID_SHIFT there,
    // and a store that silently restarted the page would hide a client
    // paging through a filter it no longer matches.
    const anchorParams = new Params();
    const { rows } = await sql.query<{ started_at: Date | string; id: string }>(
      `SELECT started_at, id FROM shifts
       WHERE client_id = ${anchorParams.add(input.clientId)}
         AND id = ${anchorParams.add(input.cursor)}`,
      anchorParams.values,
    );
    const anchor = rows[0];
    if (!anchor) throw unknownCursor(input.cursor);
    where.push(
      cursorPredicate(
        {
          startedAt: anchor.started_at instanceof Date
            ? anchor.started_at
            : new Date(anchor.started_at),
          id: anchor.id,
        },
        params,
      ),
    );
  }

  const limit = input.limit || DEFAULT_LIMIT;
  // One more than asked for, so "is there another page" is answered by the
  // rows themselves rather than by a second COUNT that could disagree with
  // them under a concurrent insert.
  const { rows } = await sql.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shifts
     WHERE ${where.join(' AND ')} ${HISTORY_ORDER} LIMIT ${limit + 1}`,
    params.values,
  );
  const items = rows.slice(0, limit).map(toShift);
  const nextCursor = rows.length > limit ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor };
}

/** Every open shift that COULD be overdue at `detectedAt`. */
export async function listOpenStartedBefore(sql: SqlRunner, detectedAt: Date): Promise<Shift[]> {
  const params = new Params();
  // Deliberately NOT narrowed to an hour, unlike the note on the seam
  // permits: the sweep's per-tenant cutoff is the service's business, and a
  // host that pre-filtered here would make the service's own window
  // untestable — the case that matters is a tenant whose window is shorter
  // than the host's guess.
  const { rows } = await sql.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shifts
     WHERE ended_at IS NULL AND started_at < ${params.add(detectedAt)} ${HISTORY_ORDER}`,
    params.values,
  );
  return rows.map(toShift);
}

/**
 * The four reads as the seam wants them: one object, bound to one runner.
 *
 * `ShiftQuery` is what both the db and each transaction expose, so this is
 * called twice with two different runners — which is exactly why the functions
 * above take the runner rather than closing over one.
 */
export function queryOver(sql: SqlRunner) {
  return {
    getShift: (clientId: string, shiftId: string) => getShift(sql, clientId, shiftId),
    getOpenShift: (clientId: string, userId: string) => getOpenShift(sql, clientId, userId),
    listOpenShifts: (clientId: string, kind?: string) => listOpenShifts(sql, clientId, kind),
    listShifts: (
  input: Required<Pick<ShiftListInput, 'clientId' | 'limit'>> &
    Omit<ShiftListInput, 'clientId' | 'limit'>,
    ) => listShifts(sql, input),
    listOpenStartedBefore: (detectedAt: Date) => listOpenStartedBefore(sql, detectedAt),
  };
}

/**
 * The package's own error for a cursor it cannot resolve.
 *
 * A real `ShiftError`, not a look-alike carrying a `code` property: the http
 * entry maps a refusal to its status with `instanceof`, so anything else falls
 * through `answering()` untouched and answers 500. That is precisely the shape
 * of the `exports`-map defect this adoption uncovered — worth not recreating
 * one file below where it was fixed.
 */
function unknownCursor(cursor: string): ShiftError {
  return new ShiftError('INVALID_SHIFT', `Unknown pagination cursor: ${cursor}.`);
}
