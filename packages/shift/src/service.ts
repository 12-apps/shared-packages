import { randomUUID } from 'node:crypto';

import { autoCloseOverdue, type CloseStoredShift } from './auto-close';
import { ShiftError } from './errors';
import type {
  AutoCloseInput,
  AutoCloseResult,
  CloseOwnShiftInput,
  CloseShiftInput,
  ForceCloseShiftInput,
  OpenShiftInput,
  Shift,
  ShiftAuditInput,
  ShiftDb,
  ShiftListInput,
  ShiftPage,
  ShiftService,
  ShiftServiceOptions,
  ShiftTransaction,
} from './types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * How far `startedAt` may sit ahead of the service clock. A caller's wall clock
 * is not this process's, so a couple of minutes of skew is tolerated — but a
 * genuinely FUTURE start is refused: such a shift can be closed by nothing. The
 * sweep skips it (its cutoff is later still) and a manual close is rejected
 * (`endedAt` would precede `startedAt`), so the one-open-shift partial index
 * locks the worker out of the tenant permanently.
 */
const MAX_CLOCK_SKEW_MS = 2 * 60_000;

/**
 * How far `startedAt` may be backdated. Backdating is legitimate ("I forgot to
 * clock in an hour ago") but unbounded backdating is not: exclusivity is a
 * point-in-time question, so a start dated before an incumbent's claim used to
 * make an occupied resource look free. A day is past any forgotten clock-in.
 */
const MAX_BACKDATE_MS = 24 * 60 * 60_000;

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ShiftError('INVALID_SHIFT', `${field} must not be empty.`);
  }
}

function startAudit(shift: Shift, actorUserId: string): ShiftAuditInput {
  return {
    clientId: shift.clientId,
    actorUserId,
    action: 'shift.start',
    resourceType: 'shift',
    resourceId: shift.id,
    before: {},
    after: {
      userId: shift.userId,
      kind: shift.kind,
      startedAt: shift.startedAt.toISOString(),
      resourceType: shift.resourceType,
      resourceId: shift.resourceId,
    },
  };
}

function endAudit(before: Shift, after: Shift, actorUserId: string | null): ShiftAuditInput {
  return {
    clientId: after.clientId,
    actorUserId,
    action: 'shift.end',
    resourceType: 'shift',
    resourceId: after.id,
    before: {
      endedAt: before.endedAt?.toISOString() ?? null,
      endedReason: before.endedReason,
      endedByUserId: before.endedByUserId,
    },
    after: {
      endedAt: after.endedAt?.toISOString() ?? null,
      endedReason: after.endedReason,
      endedByUserId: after.endedByUserId,
    },
  };
}

function validateStartedAt(startedAt: Date | undefined, now: Date): void {
  if (startedAt === undefined) return;
  const started = startedAt.getTime();
  if (!Number.isFinite(started)) {
    throw new ShiftError('INVALID_SHIFT', 'startedAt must be a valid date.');
  }
  if (started > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new ShiftError('INVALID_SHIFT', 'startedAt must not be in the future.');
  }
  if (started < now.getTime() - MAX_BACKDATE_MS) {
    throw new ShiftError(
      'INVALID_SHIFT',
      'startedAt must not be backdated by more than 24 hours.',
    );
  }
}

function validateOpenInput(input: OpenShiftInput, now: Date): void {
  requireText(input.clientId, 'clientId');
  requireText(input.userId, 'userId');
  requireText(input.actorUserId, 'actorUserId');
  if (input.kind !== 'kitchen' && input.kind !== 'service') {
    throw new ShiftError('INVALID_SHIFT', `Unknown shift kind: ${String(input.kind)}.`);
  }
  if (input.resource) {
    requireText(input.resource.type, 'resource.type');
    requireText(input.resource.id, 'resource.id');
  }
  validateStartedAt(input.startedAt, now);
}

async function releaseOwnedAssignment(
  tx: ShiftTransaction,
  shift: Shift,
  endedAt: Date,
): Promise<void> {
  if (!shift.resourceAssignmentId) return;
  const released = await tx.endAssignment({
    clientId: shift.clientId,
    assignmentId: shift.resourceAssignmentId,
    validTo: endedAt,
  });
  if (!released) {
    throw new ShiftError(
      'ASSIGNMENT_CONFLICT',
      `Shift ${shift.id} could not release its resource assignment.`,
    );
  }
}

function normalizePageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ShiftError(
      'INVALID_SHIFT',
      `limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  return limit;
}

function mapOpenError(db: ShiftDb, error: unknown): never {
  // Assignment conflicts share `user_id`/`client_id` with the open-shift
  // unique key — match the four-column / assignment constraints first so a
  // ResourceAssignment P2002 never becomes SHIFT_ALREADY_OPEN.
  if (
    db.isUniqueViolation(error, 'resource_assignments_active_unique_idx') ||
    db.isUniqueViolation(error, 'shifts_resource_assignment_id_key')
  ) {
    throw new ShiftError(
      'ASSIGNMENT_CONFLICT',
      'This worker already holds this exact active resource assignment.',
      { cause: error },
    );
  }
  if (db.isUniqueViolation(error, 'shifts_open_client_user_key')) {
    throw new ShiftError(
      'SHIFT_ALREADY_OPEN',
      'This worker already has an open shift in the tenant.',
      { cause: error },
    );
  }
  throw error;
}

type CreateId = () => string;

async function assertOpenAllowed(
  tx: ShiftTransaction,
  input: OpenShiftInput,
  exclusivityAt: Date,
): Promise<void> {
  if (await tx.getOpenShift(input.clientId, input.userId)) {
    throw new ShiftError(
      'SHIFT_ALREADY_OPEN',
      'This worker already has an open shift in the tenant.',
    );
  }
  if (input.resource?.exclusive !== true) return;
  await tx.lockExclusiveResource(
    input.clientId,
    input.resource.type,
    input.resource.id,
  );
  if (
    await tx.isResourceActive(
      input.clientId,
      input.resource.type,
      input.resource.id,
      exclusivityAt,
    )
  ) {
    throw new ShiftError('RESOURCE_TAKEN', 'The requested resource is already occupied.');
  }
}

async function createOwnedAssignment(
  tx: ShiftTransaction,
  input: OpenShiftInput,
  startedAt: Date,
  createId: CreateId,
) {
  if (!input.resource) return null;
  return tx.createAssignment({
    id: createId(),
    clientId: input.clientId,
    userId: input.userId,
    resourceType: input.resource.type,
    resourceId: input.resource.id,
    validFrom: startedAt,
  });
}

async function persistOpenShift(
  tx: ShiftTransaction,
  input: OpenShiftInput,
  clock: OpenClock,
  createId: CreateId,
): Promise<Shift> {
  const { startedAt } = clock;
  await assertOpenAllowed(tx, input, clock.exclusivityAt);
  const assignment = await createOwnedAssignment(tx, input, startedAt, createId);
  const created = await tx.createShift({
    id: createId(),
    clientId: input.clientId,
    userId: input.userId,
    kind: input.kind,
    startedAt,
    endedAt: null,
    endedReason: null,
    endedByUserId: null,
    resourceAssignmentId: assignment?.id ?? null,
    resourceType: assignment?.resourceType ?? null,
    resourceId: assignment?.resourceId ?? null,
  });
  await tx.writeAudit(startAudit(created, input.actorUserId));
  return created;
}

/**
 * The two instants an open needs. `startedAt` is what the row records (the
 * caller may backdate it within {@link MAX_BACKDATE_MS}); `exclusivityAt` is
 * `max(startedAt, now)` — the instant occupancy is judged at, so a backdated
 * start can never make a currently-claimed resource look free.
 */
interface OpenClock {
  startedAt: Date;
  exclusivityAt: Date;
}

function openClock(input: OpenShiftInput, now: Date): OpenClock {
  const startedAt = input.startedAt ?? now;
  return {
    startedAt,
    exclusivityAt: startedAt.getTime() > now.getTime() ? startedAt : now,
  };
}

async function openStoredShift(
  db: ShiftDb,
  input: OpenShiftInput,
  now: Date,
  createId: CreateId,
): Promise<Shift> {
  validateOpenInput(input, now);
  const clock = openClock(input, now);
  try {
    return await db.transaction((tx) => persistOpenShift(tx, input, clock, createId));
  } catch (error) {
    if (error instanceof ShiftError) throw error;
    return mapOpenError(db, error);
  }
}

function assertClosable(
  current: Shift | null,
  endedAt: Date,
  expectedUserId?: string,
): asserts current is Shift {
  if (!current) throw new ShiftError('SHIFT_NOT_FOUND', 'Shift not found in this tenant.');
  if (current.endedAt !== null) {
    throw new ShiftError('SHIFT_ALREADY_ENDED', 'Closed shifts are immutable.');
  }
  if (expectedUserId !== undefined && current.userId !== expectedUserId) {
    throw new ShiftError('SHIFT_NOT_OWNED', 'The shift does not belong to the requesting worker.');
  }
  if (endedAt < current.startedAt) {
    throw new ShiftError('INVALID_SHIFT', 'endedAt must not precede startedAt.');
  }
}

async function closeInTransaction(
  tx: ShiftTransaction,
  input: CloseShiftInput,
  endedAt: Date,
  expectedUserId?: string,
): Promise<Shift> {
  const current = await tx.getShift(input.clientId, input.shiftId);
  assertClosable(current, endedAt, expectedUserId);
  const ended = await tx.endShift({
    clientId: input.clientId,
    shiftId: input.shiftId,
    endedAt,
    endedReason: input.reason,
    endedByUserId: input.byUserId,
  });
  if (!ended) {
    throw new ShiftError('SHIFT_ALREADY_ENDED', 'The shift was closed concurrently.');
  }
  await releaseOwnedAssignment(tx, current, endedAt);
  await tx.writeAudit(endAudit(current, ended, input.byUserId));
  return ended;
}

function createCloseStoredShift(db: ShiftDb, now: () => Date): CloseStoredShift {
  return async (input, expectedUserId) => {
    requireText(input.clientId, 'clientId');
    requireText(input.shiftId, 'shiftId');
    if (input.byUserId !== null) requireText(input.byUserId, 'byUserId');
    const endedAt = input.endedAt ?? now();
    return db.transaction((tx) => closeInTransaction(tx, input, endedAt, expectedUserId));
  };
}

export function createShiftService(db: ShiftDb, options: ShiftServiceOptions = {}): ShiftService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const closeShift = createCloseStoredShift(db, now);

  return {
    openShift(input) {
      return openStoredShift(db, input, now(), createId);
    },
    closeOwnShift(input: CloseOwnShiftInput) {
      requireText(input.userId, 'userId');
      return closeShift(
        {
          clientId: input.clientId,
          shiftId: input.shiftId,
          byUserId: input.userId,
          reason: 'user',
          endedAt: input.endedAt,
        },
        input.userId,
      );
    },
    forceCloseShift(input: ForceCloseShiftInput) {
      return closeShift({ ...input, reason: 'supervisor' });
    },
    getShift(input) {
      return db.getShift(input.clientId, input.shiftId);
    },
    getOpenShift(input) {
      return db.getOpenShift(input.clientId, input.userId);
    },
    listOpenShifts(input) {
      return db.listOpenShifts(input.clientId, input.kind);
    },
    listShifts(input: ShiftListInput): Promise<ShiftPage> {
      return db.listShifts({ ...input, limit: normalizePageSize(input.limit) });
    },
    autoCloseOverdue(input: AutoCloseInput): Promise<AutoCloseResult> {
      const detectedAt = input.detectedAt ?? now();
      return autoCloseOverdue(db, input, detectedAt, closeShift);
    },
  };
}
