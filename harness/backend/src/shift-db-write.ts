/**
 * The WRITE half of the `ShiftDb` seam: everything reachable only inside a
 * transaction.
 *
 * Separated from the reads (`shift-db-read.ts`) because the two have different
 * rules, not merely different sizes. A read may run on the db or on a
 * transaction; every function here may run ONLY on a transaction, because each
 * one is half of a pair that has to commit together — a claim and the shift
 * that holds it, a close and the claim it frees, a write and its trail entry.
 */
import { ShiftError } from '@12-apps/shift';
import type { ResourceAssignment, ShiftAuditInput, ShiftTransaction } from '@12-apps/shift/types';

import { getOpenShift, getShift } from './shift-db-read';
import { AssignmentRow, Params, SHIFT_COLUMNS, ShiftRow, toAssignment, toShift, type SqlRunner } from './shift-rows';

/**
 * Serialise the check-then-insert that precedes an exclusive claim.
 *
 * `hashtextextended` rather than a pair of `hashtext`s: the two-argument
 * advisory lock takes int4s, and folding three strings into two int4s collides
 * far more readily than into one int8 — a false collision here is two unrelated
 * resources serialising against each other, a silent throughput bug rather than
 * a wrong answer.
 */
async function lockExclusiveResource(
  sql: SqlRunner,
  clientId: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  const params = new Params();
  await sql.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended(${params.add(`${clientId}:${resourceType}:${resourceId}`)}, 0))`,
    params.values,
  );
}

/** Is this resource claimed at `at`? */
async function isResourceActive(
  sql: SqlRunner,
  clientId: string,
  resourceType: string,
  resourceId: string,
  at: Date,
): Promise<boolean> {
  const params = new Params();
  // `valid_to IS NULL OR valid_to > at`, and deliberately NOT gated on
  // `valid_from <= at` — the seam spells out why: a claim that starts later
  // still conflicts with one opening now, and treating it as free hands the
  // same resource to two workers with the later claim silently winning.
  const { rows } = await sql.query<{ one: number }>(
    `SELECT 1 AS one FROM resource_assignments
     WHERE client_id = ${params.add(clientId)}
       AND resource_type = ${params.add(resourceType)}
       AND resource_id = ${params.add(resourceId)}
       AND (valid_to IS NULL OR valid_to > ${params.add(at)})
     LIMIT 1`,
    params.values,
  );
  return rows.length > 0;
}

/** Record a claim. The partial unique index is what refuses a second live one. */
async function createAssignment(
  sql: SqlRunner,
  input: Omit<ResourceAssignment, 'validTo'>,
): Promise<ResourceAssignment> {
  const params = new Params();
  const { rows } = await sql.query<AssignmentRow>(
    `INSERT INTO resource_assignments
       (id, client_id, user_id, resource_type, resource_id, valid_from, valid_to)
     VALUES (${params.add(input.id)}, ${params.add(input.clientId)},
             ${params.add(input.userId)}, ${params.add(input.resourceType)},
             ${params.add(input.resourceId)}, ${params.add(input.validFrom)}, NULL)
     RETURNING id, client_id, user_id, resource_type, resource_id, valid_from, valid_to`,
    params.values,
  );
  const row = rows[0];
  if (!row) throw new Error('resource_assignments INSERT returned no row');
  return toAssignment(row);
}

/** Insert the shift, snapshot columns and all. */
async function createShift(sql: SqlRunner, shift: Parameters<ShiftTransaction['createShift']>[0]) {
  const params = new Params();
  const { rows } = await sql.query<ShiftRow>(
    `INSERT INTO shifts
       (id, client_id, user_id, kind, started_at, ended_at, ended_reason,
        ended_by_user_id, resource_assignment_id, resource_type, resource_id)
     VALUES (${params.add(shift.id)}, ${params.add(shift.clientId)},
             ${params.add(shift.userId)}, ${params.add(shift.kind)},
             ${params.add(shift.startedAt)}, NULL, NULL, NULL,
             ${params.add(shift.resourceAssignmentId)},
             ${params.add(shift.resourceType)}, ${params.add(shift.resourceId)})
     RETURNING ${SHIFT_COLUMNS}`,
    params.values,
  );
  const row = rows[0];
  if (!row) throw new Error('shifts INSERT returned no row');
  return toShift(row);
}

/** Close an OPEN shift; null means there was nothing open to close. */
async function endShift(sql: SqlRunner, input: Parameters<ShiftTransaction['endShift']>[0]) {
  const params = new Params();
  // `ended_at IS NULL` in the predicate, not a read-then-write: closing an
  // already-closed shift has to be distinguishable from closing a missing
  // one, and the package reads a null return as "nothing to close". The
  // package's own trigger would refuse the UPDATE anyway; answering null is
  // what turns that into its 409 instead of a 500.
  const { rows } = await sql.query<ShiftRow>(
    `UPDATE shifts
        SET ended_at = ${params.add(input.endedAt)},
            ended_reason = ${params.add(input.endedReason)},
            ended_by_user_id = ${params.add(input.endedByUserId)}
      WHERE client_id = ${params.add(input.clientId)}
        AND id = ${params.add(input.shiftId)}
        AND ended_at IS NULL
    RETURNING ${SHIFT_COLUMNS}`,
    params.values,
  );
  return rows[0] ? toShift(rows[0]) : null;
}

/** Free a live claim. */
async function endAssignment(sql: SqlRunner, input: Parameters<ShiftTransaction['endAssignment']>[0]) {
  const params = new Params();
  const { rows } = await sql.query<{ id: string }>(
    `UPDATE resource_assignments
        SET valid_to = ${params.add(input.validTo)}
      WHERE client_id = ${params.add(input.clientId)}
        AND id = ${params.add(input.assignmentId)}
        AND valid_to IS NULL
    RETURNING id`,
    params.values,
  );
  return rows.length > 0;
}

/** The trail entry, written inside the same transaction as the write it describes. */
async function writeAudit(sql: SqlRunner, input: ShiftAuditInput): Promise<void> {
  const params = new Params();
  await sql.query(
    `INSERT INTO shift_audits
       (client_id, actor_user_id, action, resource_type, resource_id, before, after)
     VALUES (${params.add(input.clientId)}, ${params.add(input.actorUserId)},
             ${params.add(input.action)}, ${params.add(input.resourceType)},
             ${params.add(input.resourceId)}, ${params.add(JSON.stringify(input.before))},
             ${params.add(JSON.stringify(input.after))})`,
    params.values,
  );
}

/**
 * The transaction seam, bound to one runner.
 *
 * Two of the five reads are reused verbatim from the read half — a transaction
 * has to see its own uncommitted rows, which is the whole reason `ShiftQuery`
 * takes a runner rather than a database.
 */
export function transactionOver(sql: SqlRunner): ShiftTransaction {
  return {
    getShift: (clientId, shiftId) => getShift(sql, clientId, shiftId),
    getOpenShift: (clientId, userId) => getOpenShift(sql, clientId, userId),
    lockExclusiveResource: (clientId, resourceType, resourceId) =>
  lockExclusiveResource(sql, clientId, resourceType, resourceId),
    isResourceActive: (clientId, resourceType, resourceId, at) =>
  isResourceActive(sql, clientId, resourceType, resourceId, at),
    createAssignment: (input) => createAssignment(sql, input),
    createShift: (shift) => createShift(sql, shift),
    endShift: (input) => endShift(sql, input),
    endAssignment: (input) => endAssignment(sql, input),
    writeAudit: (input) => writeAudit(sql, input),
  };
}
