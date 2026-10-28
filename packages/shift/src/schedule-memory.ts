import { slotIsStorable } from './schedule-context';
import { validateRule } from './schedule-rule';
import type { ShiftSlotSeries } from './schedule-series-types';
import type {
  ListSlotsInput,
  ShiftScheduleAuditInput,
  ShiftScheduleDb,
  ShiftScheduleTransaction,
  ShiftSlot,
} from './schedule-types';

interface ScheduleState {
  slots: ShiftSlot[];
  series: ShiftSlotSeries[];
  audits: ShiftScheduleAuditInput[];
}

function cloneSeries(series: ShiftSlotSeries): ShiftSlotSeries {
  return {
    ...series,
    weekdays: [...series.weekdays],
    skippedDates: [...series.skippedDates],
    createdAt: new Date(series.createdAt),
    coverage: series.coverage ? series.coverage.map((entry) => ({ ...entry })) : null,
  };
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
    series: state.series.map(cloneSeries),
    audits: state.audits.map((audit) => ({ ...audit, before: { ...audit.before }, after: { ...audit.after } })),
  };
}

const byStart = (a: ShiftSlot, b: ShiftSlot): number => a.startsAt.getTime() - b.startsAt.getTime();

function overlaps(slot: ShiftSlot, from: Date, to: Date): boolean {
  return slot.startsAt < to && from < slot.endsAt;
}

/** What the table's CHECK constraints refuse, so a test cannot pass what Postgres would not. */
function assertStorable(slot: ShiftSlot): void {
  if (slot.kind.trim() === '' || !slotIsStorable(slot)) {
    throw new Error(`shift_slots CHECK violated by slot ${slot.id}.`);
  }
}

function assertSeriesStorable(series: ShiftSlotSeries): void {
  try {
    validateRule(series);
  } catch (cause) {
    throw new Error(`shift_slot_series CHECK violated by series ${series.id}.`, { cause });
  }
}

function belongsTo(slot: ShiftSlot, clientId: string, seriesId: string): boolean {
  return slot.clientId === clientId && (slot.seriesId === seriesId || slot.originSeriesId === seriesId);
}

function seriesOps(state: ScheduleState): Pick<ShiftScheduleTransaction, 'getSeries' | 'createSeries' | 'updateSeries'> {
  const find = (clientId: string, seriesId: string): ShiftSlotSeries | undefined =>
    state.series.find((series) => series.clientId === clientId && series.id === seriesId);
  return {
    getSeries: async (clientId, seriesId) => {
      const found = find(clientId, seriesId);
      return found ? cloneSeries(found) : null;
    },
    createSeries: async (series) => {
      assertSeriesStorable(series);
      if (state.series.some((other) => other.id === series.id)) throw new Error(`Duplicate series ${series.id}.`);
      state.series.push(cloneSeries(series));
    },
    updateSeries: async (clientId, seriesId, patch) => {
      const found = find(clientId, seriesId);
      if (!found) throw new Error(`No series ${seriesId}.`);
      Object.assign(found, cloneSeries({ ...found, ...patch }));
      return cloneSeries(found);
    },
  };
}

function slotEdits(state: ScheduleState): Pick<ShiftScheduleTransaction, 'updateSlot' | 'restoreSlots' | 'listSeriesRows'> {
  return {
    updateSlot: async (clientId, slotId, patch) => {
      const found = state.slots.find((slot) => slot.clientId === clientId && slot.id === slotId);
      if (!found) throw new Error(`No slot ${slotId}.`);
      const next = cloneSlot({ ...found, ...patch });
      assertStorable(next);
      Object.assign(found, next);
      return cloneSlot(found);
    },
    restoreSlots: async (clientId, slotIds) => {
      const wanted = new Set(slotIds);
      const canceled = state.slots.filter(
        (slot) => slot.clientId === clientId && wanted.has(slot.id) && slot.canceledAt !== null,
      );
      for (const slot of canceled) Object.assign(slot, { canceledAt: null, canceledByUserId: null, cancelReason: null });
      return canceled.map(cloneSlot);
    },
    listSeriesRows: async (clientId, seriesId, from, to) =>
      state.slots
        .filter((slot) => belongsTo(slot, clientId, seriesId) && slot.startsAt >= from && slot.startsAt < to)
        .sort(byStart)
        .map(cloneSlot),
  };
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
    ...seriesOps(state),
    ...slotEdits(state),
    writeAudit: async (audit) => {
      state.audits.push({ ...audit, before: { ...audit.before }, after: { ...audit.after } });
    },
  };
}

export interface MemoryShiftScheduleDb extends ShiftScheduleDb {
  /** Every slot, canceled included — for assertions. */
  slots(): ShiftSlot[];
  series(): ShiftSlotSeries[];
  audits(): ShiftScheduleAuditInput[];
}

/**
 * An in-memory {@link ShiftScheduleDb} for tests and examples. A transaction
 * works on a copy and commits it only when the work resolves, so a refusal
 * leaves nothing behind — as Postgres would.
 */
export function createMemoryShiftScheduleDb(): MemoryShiftScheduleDb {
  let state: ScheduleState = { slots: [], series: [], audits: [] };
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
    async listOpenSeries(onOrAfter) {
      return state.series.filter((series) => series.endsOn === null || series.endsOn >= onOrAfter).map(cloneSeries);
    },
    slots: () => state.slots.map(cloneSlot),
    series: () => state.series.map(cloneSeries),
    audits: () => state.audits.map((audit) => ({ ...audit })),
  };
}
