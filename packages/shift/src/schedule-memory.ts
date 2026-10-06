import type {
  ListSlotsInput,
  ShiftScheduleAuditInput,
  ShiftScheduleDb,
  ShiftScheduleTransaction,
  ShiftSlot,
} from './schedule-types';

interface ScheduleState {
  slots: ShiftSlot[];
  audits: ShiftScheduleAuditInput[];
}

function cloneSlot(slot: ShiftSlot): ShiftSlot {
  return {
    ...slot,
    startsAt: new Date(slot.startsAt),
    endsAt: new Date(slot.endsAt),
    createdAt: new Date(slot.createdAt),
    canceledAt: slot.canceledAt === null ? null : new Date(slot.canceledAt),
    coverage: slot.coverage ? slot.coverage.map((entry) => ({ ...entry })) : null,
  };
}

function cloneState(state: ScheduleState): ScheduleState {
  return {
    slots: state.slots.map(cloneSlot),
    audits: state.audits.map((audit) => ({ ...audit, before: { ...audit.before }, after: { ...audit.after } })),
  };
}

const byStart = (a: ShiftSlot, b: ShiftSlot): number => a.startsAt.getTime() - b.startsAt.getTime();

function overlaps(slot: ShiftSlot, from: Date, to: Date): boolean {
  return slot.startsAt < to && from < slot.endsAt;
}

const MAX_SLOT_MS = 24 * 60 * 60_000;

/** What the table's CHECK constraints refuse, so a test cannot pass what Postgres would not. */
function assertStorable(slot: ShiftSlot): void {
  const length = slot.endsAt.getTime() - slot.startsAt.getTime();
  if (slot.kind.trim() === '' || !(length > 0) || length > MAX_SLOT_MS) {
    throw new Error(`shift_slots CHECK violated by slot ${slot.id}.`);
  }
}

function transactionOver(state: ScheduleState): ShiftScheduleTransaction {
  return {
    lockUserSchedule: async () => undefined,
    listLiveOverlapping: async (clientId, userId, from, to) =>
      state.slots
        .filter((slot) => slot.clientId === clientId && slot.userId === userId)
        .filter((slot) => slot.canceledAt === null && overlaps(slot, from, to))
        .map(cloneSlot),
    getSlot: async (clientId, slotId) => {
      const found = state.slots.find((slot) => slot.clientId === clientId && slot.id === slotId);
      return found ? cloneSlot(found) : null;
    },
    createSlots: async (slots) => {
      for (const slot of slots) assertStorable(slot);
      state.slots.push(...slots.map(cloneSlot));
    },
    cancelSlots: async ({ clientId, slotIds, canceledAt, canceledByUserId, cancelReason }) => {
      const wanted = new Set(slotIds);
      const live = state.slots.filter(
        (slot) => slot.clientId === clientId && wanted.has(slot.id) && slot.canceledAt === null,
      );
      for (const slot of live) Object.assign(slot, { canceledAt: new Date(canceledAt), canceledByUserId, cancelReason });
      return live.map(cloneSlot);
    },
    listSeriesFrom: async (clientId, seriesId, from) =>
      state.slots
        .filter((slot) => slot.clientId === clientId && slot.seriesId === seriesId)
        .filter((slot) => slot.canceledAt === null && slot.startsAt >= from)
        .sort(byStart)
        .map(cloneSlot),
    writeAudit: async (audit) => {
      state.audits.push({ ...audit, before: { ...audit.before }, after: { ...audit.after } });
    },
  };
}

export interface MemoryShiftScheduleDb extends ShiftScheduleDb {
  /** Every slot, canceled included — for assertions. */
  slots(): ShiftSlot[];
  audits(): ShiftScheduleAuditInput[];
}

/**
 * An in-memory {@link ShiftScheduleDb} for tests and examples. A transaction
 * works on a copy and commits it only when the work resolves, so a refusal
 * leaves nothing behind — as Postgres would.
 */
export function createMemoryShiftScheduleDb(): MemoryShiftScheduleDb {
  let state: ScheduleState = { slots: [], audits: [] };
  // One transaction at a time, as the host's per-worker lock would make them:
  // without it two overlapping drafts both commit and the first is lost.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    transaction(work) {
      const run = queue.then(async () => {
        const draft = cloneState(state);
        const result = await work(transactionOver(draft));
        state = draft;
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async listSlots(input: ListSlotsInput) {
      return state.slots
        .filter((slot) => slot.clientId === input.clientId)
        .filter((slot) => input.userId === undefined || slot.userId === input.userId)
        .filter((slot) => input.includeCanceled === true || slot.canceledAt === null)
        .filter((slot) => overlaps(slot, input.from, input.to))
        .sort(byStart)
        .map(cloneSlot);
    },
    async listUpcoming({ clientIds, userId, after, limit }) {
      const tenants = new Set(clientIds);
      return state.slots
        .filter((slot) => tenants.has(slot.clientId) && slot.userId === userId)
        .filter((slot) => slot.canceledAt === null && slot.endsAt > after)
        .sort(byStart)
        .slice(0, limit)
        .map(cloneSlot);
    },
    slots: () => state.slots.map(cloneSlot),
    audits: () => state.audits.map((audit) => ({ ...audit })),
  };
}
