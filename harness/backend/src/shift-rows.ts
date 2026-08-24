/**
 * The row layer under `shift-db.ts`: what a `shifts` / `resource_assignments`
 * row is, and how the seam's list query becomes SQL.
 *
 * Split out for the same reason `discounts-rows.ts` is — the store reads better
 * when the mapping is somewhere else — and it is the half worth reading on its
 * own here, because two of the mappings are load-bearing rather than mechanical:
 * the keyset page and the resource snapshot.
 */
import type { ResourceAssignment, Shift, ShiftEndReason, ShiftListInput } from '@12-apps/shift/types';

import { Params, type SqlRunner } from './rbac-db-shared';

export type { SqlRunner };

/** Every column of `shifts`, in the order the SELECTs below name them. */
export const SHIFT_COLUMNS =
  'id, client_id, user_id, kind, started_at, ended_at, ended_reason, ended_by_user_id, ' +
  'resource_assignment_id, resource_type, resource_id';

export interface ShiftRow {
  id: string;
  client_id: string;
  user_id: string;
  kind: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  ended_reason: string | null;
  ended_by_user_id: string | null;
  resource_assignment_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
}

export interface AssignmentRow {
  id: string;
  client_id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
  valid_from: Date | string;
  valid_to: Date | string | null;
}

/**
 * PGlite hands a `TIMESTAMP(3)` back as a `Date` most of the time and as a
 * string when the value came through a parameter it did not have to parse.
 * Normalising here rather than at each call site is what keeps `Shift.startedAt`
 * genuinely a `Date` for the service, which compares it against `now()`.
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

export function toShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    kind: row.kind,
    startedAt: asDate(row.started_at),
    endedAt: asNullableDate(row.ended_at),
    endedReason: row.ended_reason as ShiftEndReason | null,
    endedByUserId: row.ended_by_user_id,
    // The three resource columns are a SNAPSHOT the package's own CHECK keeps
    // all-or-nothing, so mapping them independently is safe: there is no state
    // where one is set and another is not.
    resourceAssignmentId: row.resource_assignment_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
  };
}

export function toAssignment(row: AssignmentRow): ResourceAssignment {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    validFrom: asDate(row.valid_from),
    validTo: asNullableDate(row.valid_to),
  };
}

/**
 * The history order, as one expression both the page and its cursor use.
 *
 * Newest first, `id` breaking a tie — and the tie is not hypothetical: the
 * origin host opens shifts through a service whose clock is the transaction's,
 * so two shifts opened in the same millisecond compare equal on `started_at`
 * alone. A page ordered on that column by itself can then repeat a row on one
 * request and skip it on the next, which reads as data loss rather than as a
 * missing tiebreak.
 */
export const HISTORY_ORDER = 'ORDER BY started_at DESC, id DESC';

/**
 * The window a history request asks for, as a predicate.
 *
 * `to` is EXCLUSIVE and `from` inclusive, matching the package's in-memory
 * driver exactly — a host that flipped either would page a day's boundary
 * differently from the reference implementation, and only across midnight.
 */
export function historyPredicate(
  input: Pick<ShiftListInput, 'clientId' | 'userId' | 'kind' | 'from' | 'to'>,
  params: Params,
): string {
  const where = [`client_id = ${params.add(input.clientId)}`];
  if (input.userId !== undefined) where.push(`user_id = ${params.add(input.userId)}`);
  if (input.kind !== undefined) where.push(`kind = ${params.add(input.kind)}`);
  if (input.from !== undefined) where.push(`started_at >= ${params.add(input.from)}`);
  if (input.to !== undefined) where.push(`started_at < ${params.add(input.to)}`);
  return where.join(' AND ');
}

/**
 * Rows strictly after `cursor` in {@link HISTORY_ORDER}, as a predicate.
 *
 * A keyset rather than an OFFSET, because the list is newest-first and a shift
 * opening mid-page would shift every later row down by one — the classic
 * skipped record. Comparing the pair lexicographically is what makes the
 * tiebreak above actually page.
 */
export function cursorPredicate(anchor: { startedAt: Date; id: string }, params: Params): string {
  const startedAt = params.add(anchor.startedAt);
  const id = params.add(anchor.id);
  return `(started_at < ${startedAt} OR (started_at = ${startedAt} AND id < ${id}))`;
}

/** A fresh parameter list, re-exported so the store needs one import fewer. */
export { Params };
