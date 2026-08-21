import { ShiftError } from './errors';
import type {
  ResourceAssignment,
  Shift,
  ShiftAuditInput,
  ShiftDb,
  ShiftListInput,
  ShiftPage,
  ShiftTransaction,
  ShiftUniqueConstraint,
} from './types';

interface MemoryState {
  shifts: Shift[];
  assignments: ResourceAssignment[];
  audits: ShiftAuditInput[];
}

type FailurePoint = 'assignment' | 'shift' | 'audit' | 'end-shift' | 'end-assignment';

interface ConstraintError extends Error {
  constraint: ShiftUniqueConstraint;
}

function constraintError(constraint: ShiftUniqueConstraint): ConstraintError {
  return Object.assign(new Error(`Unique constraint failed: ${constraint}`), {
    constraint,
  });
}

function cloneDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function cloneShift(shift: Shift): Shift {
  return {
    ...shift,
    startedAt: new Date(shift.startedAt),
    endedAt: cloneDate(shift.endedAt),
  };
}

function cloneAssignment(assignment: ResourceAssignment): ResourceAssignment {
  return {
    ...assignment,
    validFrom: new Date(assignment.validFrom),
    validTo: cloneDate(assignment.validTo),
  };
}

function cloneAudit(audit: ShiftAuditInput): ShiftAuditInput {
  return { ...audit, before: { ...audit.before }, after: { ...audit.after } };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    shifts: state.shifts.map(cloneShift),
    assignments: state.assignments.map(cloneAssignment),
    audits: state.audits.map(cloneAudit),
  };
}

function compareNewest(first: Shift, second: Shift): number {
  const time = second.startedAt.getTime() - first.startedAt.getTime();
  return time === 0 ? second.id.localeCompare(first.id) : time;
}

function inHistoryWindow(shift: Shift, input: ShiftListInput): boolean {
  if (input.userId && shift.userId !== input.userId) return false;
  if (input.kind && shift.kind !== input.kind) return false;
  if (input.from && shift.startedAt < input.from) return false;
  if (input.to && shift.startedAt >= input.to) return false;
  return true;
}

/**
 * Page past `cursor`. An id that is not in the ordered result is REJECTED, not
 * silently treated as "start from the top" — that is what a Prisma-backed host
 * does with an unresolvable cursor, and a driver that quietly restarts the page
 * would hide a client paging through a filter it no longer matches.
 */
function afterCursor(ordered: Shift[], cursor: string | undefined): Shift[] {
  if (cursor === undefined) return ordered;
  const index = ordered.findIndex((row) => row.id === cursor);
  if (index < 0) {
    throw new ShiftError('INVALID_SHIFT', `Unknown pagination cursor: ${cursor}.`);
  }
  return ordered.slice(index + 1);
}

function createQuery(state: MemoryState) {
  return {
    async getShift(clientId: string, shiftId: string): Promise<Shift | null> {
      const shift = state.shifts.find((row) => row.clientId === clientId && row.id === shiftId);
      return shift ? cloneShift(shift) : null;
    },
    async getOpenShift(clientId: string, userId: string): Promise<Shift | null> {
      const shift = state.shifts.find(
        (row) => row.clientId === clientId && row.userId === userId && row.endedAt === null,
      );
      return shift ? cloneShift(shift) : null;
    },
    async listOpenShifts(clientId: string, kind?: string): Promise<Shift[]> {
      return state.shifts
        .filter(
          (row) =>
            row.clientId === clientId &&
            row.endedAt === null &&
            (kind === undefined || row.kind === kind),
        )
        .sort(compareNewest)
        .map(cloneShift);
    },
    async listShifts(
      input: Required<Pick<ShiftListInput, 'clientId' | 'limit'>> &
        Omit<ShiftListInput, 'clientId' | 'limit'>,
    ): Promise<ShiftPage> {
      const ordered = state.shifts
        .filter((row) => row.clientId === input.clientId && inHistoryWindow(row, input))
        .sort(compareNewest);
      const page = afterCursor(ordered, input.cursor).slice(0, input.limit + 1);
      const hasMore = page.length > input.limit;
      const items = page.slice(0, input.limit).map(cloneShift);
      return {
        items,
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      };
    },
    async listOpenStartedBefore(cutoff: Date): Promise<Shift[]> {
      return state.shifts
        .filter((row) => row.endedAt === null && row.startedAt <= cutoff)
        .sort(compareNewest)
        .map(cloneShift);
    },
  };
}

export interface MemoryShiftDb extends ShiftDb {
  snapshot(): MemoryState;
  seedAssignment(
    input: Omit<ResourceAssignment, 'id' | 'validTo'> & {
      id?: string;
      validTo?: Date | null;
    },
  ): string;
  failNext(point: FailurePoint): void;
}

type FailIfRequested = (point: FailurePoint) => void;
type AssignmentInput = Parameters<ShiftTransaction['createAssignment']>[0];
type EndShiftInput = Parameters<ShiftTransaction['endShift']>[0];
type EndAssignmentInput = Parameters<ShiftTransaction['endAssignment']>[0];

function hasActiveAssignment(state: MemoryState, input: AssignmentInput): boolean {
  return state.assignments.some(
    (row) =>
      row.clientId === input.clientId &&
      row.userId === input.userId &&
      row.resourceType === input.resourceType &&
      row.resourceId === input.resourceId &&
      row.validTo === null,
  );
}

function addAssignment(
  state: MemoryState,
  input: AssignmentInput,
  fail: FailIfRequested,
): ResourceAssignment {
  fail('assignment');
  if (hasActiveAssignment(state, input)) {
    throw constraintError('resource_assignments_active_unique_idx');
  }
  const assignment: ResourceAssignment = { ...input, validTo: null };
  state.assignments.push(cloneAssignment(assignment));
  return cloneAssignment(assignment);
}

function addShift(state: MemoryState, shift: Shift, fail: FailIfRequested): Shift {
  fail('shift');
  const alreadyOpen = state.shifts.some(
    (row) => row.clientId === shift.clientId && row.userId === shift.userId && row.endedAt === null,
  );
  if (alreadyOpen) throw constraintError('shifts_open_client_user_key');
  const assignmentUsed =
    shift.resourceAssignmentId !== null &&
    state.shifts.some((row) => row.resourceAssignmentId === shift.resourceAssignmentId);
  if (assignmentUsed) throw constraintError('shifts_resource_assignment_id_key');
  state.shifts.push(cloneShift(shift));
  return cloneShift(shift);
}

function endStoredShift(
  state: MemoryState,
  input: EndShiftInput,
  fail: FailIfRequested,
): Shift | null {
  fail('end-shift');
  const index = state.shifts.findIndex(
    (row) => row.clientId === input.clientId && row.id === input.shiftId && row.endedAt === null,
  );
  const current = state.shifts[index];
  if (index < 0 || !current) return null;
  const ended: Shift = {
    ...current,
    endedAt: new Date(input.endedAt),
    endedReason: input.endedReason,
    endedByUserId: input.endedByUserId,
  };
  state.shifts[index] = ended;
  return cloneShift(ended);
}

function endStoredAssignment(
  state: MemoryState,
  input: EndAssignmentInput,
  fail: FailIfRequested,
): boolean {
  fail('end-assignment');
  const index = state.assignments.findIndex(
    (row) =>
      row.clientId === input.clientId && row.id === input.assignmentId && row.validTo === null,
  );
  const current = state.assignments[index];
  if (index < 0 || !current) return false;
  state.assignments[index] = { ...current, validTo: new Date(input.validTo) };
  return true;
}

/**
 * Mirrors `ShiftTransaction.isResourceActive`: a claim is active while it has
 * not been released. `validFrom` is deliberately not consulted — a claim that
 * begins later still occupies the resource.
 */
function isAssignmentActiveAt(assignment: ResourceAssignment, at: Date): boolean {
  return assignment.validTo === null || assignment.validTo.getTime() > at.getTime();
}

function createTransaction(state: MemoryState, fail: FailIfRequested): ShiftTransaction {
  return {
    ...createQuery(state),
    async lockExclusiveResource() {
      // Single-threaded memory host: the transaction already serializes writers.
    },
    async isResourceActive(clientId, resourceType, resourceId, at) {
      return state.assignments.some(
        (row) =>
          row.clientId === clientId &&
          row.resourceType === resourceType &&
          row.resourceId === resourceId &&
          isAssignmentActiveAt(row, at),
      );
    },
    async createAssignment(input) {
      return addAssignment(state, input, fail);
    },
    async createShift(shift) {
      return addShift(state, shift, fail);
    },
    async endShift(input) {
      return endStoredShift(state, input, fail);
    },
    async endAssignment(input) {
      return endStoredAssignment(state, input, fail);
    },
    async writeAudit(input) {
      fail('audit');
      state.audits.push(cloneAudit(input));
    },
  };
}

export function createMemoryShiftDb(): MemoryShiftDb {
  let state: MemoryState = { shifts: [], assignments: [], audits: [] };
  let seedSequence = 0;
  const failures = new Set<FailurePoint>();

  const failIfRequested = (point: FailurePoint): void => {
    if (!failures.delete(point)) return;
    throw new Error(`injected ${point} failure`);
  };

  const db: MemoryShiftDb = {
    ...createQuery(state),
    async transaction<T>(work: (tx: ShiftTransaction) => Promise<T>): Promise<T> {
      const draft = cloneState(state);
      const result = await work(createTransaction(draft, failIfRequested));
      state = draft;
      Object.assign(db, createQuery(state));
      return result;
    },
    isUniqueViolation(error, constraint) {
      return (
        typeof error === 'object' &&
        error !== null &&
        (error as { constraint?: unknown }).constraint === constraint
      );
    },
    snapshot() {
      return cloneState(state);
    },
    seedAssignment(input) {
      const id = input.id ?? `seed-assignment-${++seedSequence}`;
      state.assignments.push({
        id,
        clientId: input.clientId,
        userId: input.userId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        validFrom: new Date(input.validFrom),
        validTo: input.validTo === undefined ? null : cloneDate(input.validTo),
      });
      return id;
    },
    failNext(point) {
      failures.add(point);
    },
  };
  return db;
}
