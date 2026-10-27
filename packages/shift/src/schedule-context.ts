import { ShiftScheduleError } from './schedule-errors';
import type { ScheduleChange, ShiftSlotPrior, ShiftSlotSeries } from './schedule-series-types';
import type { ShiftScheduleDb, ShiftScheduleTransaction, ShiftSlot, ShiftSlotCoverage } from './schedule-types';
import type { ShiftVocabulary } from './vocabulary';

export const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** A slot longer than a day is a typo, not a plan. */
export const MAX_SLOT_MS = DAY_MS;
export const DAY_MINUTES = 24 * 60;

/** A write's resource and coverage, defaulted to none — copied, never shared. */
export function resourceFields(input: {
  resource?: { type: string; id: string } | null;
  coverage?: readonly ShiftSlotCoverage[] | null;
}): Pick<ShiftSlot, 'resourceType' | 'resourceId' | 'coverage'> {
  return {
    resourceType: input.resource?.type ?? null,
    resourceId: input.resource?.id ?? null,
    coverage: input.coverage ? input.coverage.map((entry) => ({ ...entry })) : null,
  };
}

export interface ScheduleContext {
  db: ShiftScheduleDb;
  vocabulary: ShiftVocabulary<string>;
  now: () => Date;
  createId: () => string;
  maxRepeatWeeks: number;
  dueWindowMinutes: number;
  horizonWeeks: number;
}

export function invalid(message: string): ShiftScheduleError {
  return new ShiftScheduleError('INVALID_SLOT', message);
}

export function requireText(value: string, field: string): void {
  if (value.trim().length === 0) throw invalid(`${field} must not be empty.`);
}

/** The tenant, the person and the actor are named, and the kind is the host's. */
export function validateWho(
  ctx: ScheduleContext,
  input: { clientId: string; userId: string; actorUserId: string; kind: string },
): void {
  requireText(input.clientId, 'clientId');
  requireText(input.userId, 'userId');
  requireText(input.actorUserId, 'actorUserId');
  if (!ctx.vocabulary.has(input.kind)) throw invalid(`Unknown kind: ${input.kind}.`);
}

function isMinuteCount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Both null or both set, whole minutes, and strictly inside a slot `lengthMinutes` long. */
export function validateBreak(
  offset: number | null | undefined,
  minutes: number | null | undefined,
  lengthMinutes: number,
): void {
  const hasOffset = offset !== null && offset !== undefined;
  const hasMinutes = minutes !== null && minutes !== undefined;
  if (hasOffset !== hasMinutes) throw invalid('breakOffsetMinutes and breakMinutes go together: both or neither.');
  if (!hasOffset || !hasMinutes) return;
  if (!isMinuteCount(offset) || !isMinuteCount(minutes) || offset + minutes >= lengthMinutes) {
    throw invalid('The break must lie strictly inside the slot.');
  }
}

/** The slot lasts more than nothing and at most a day, and its break fits inside it. */
export function slotIsStorable(slot: ShiftSlot): boolean {
  const length = slot.endsAt.getTime() - slot.startsAt.getTime();
  if (!(length > 0) || length > MAX_SLOT_MS) return false;
  try {
    validateBreak(slot.breakOffsetMinutes, slot.breakMinutes, length / MINUTE_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse a start already past, unless `allowRunning` admits a slot under way.
 * An end already past is never admitted.
 */
export function refusePastStart(startsAt: Date, endsAt: Date, now: Date, allowRunning: boolean | undefined): void {
  if (startsAt.getTime() >= now.getTime()) return;
  if (allowRunning === true && endsAt.getTime() > now.getTime()) return;
  throw invalid(allowRunning === true ? 'A slot may not end in the past.' : 'A slot may not start in the past.');
}

function overlapsAny(slot: ShiftSlot, others: readonly ShiftSlot[]): boolean {
  return others.some((other) => other.id !== slot.id && other.startsAt < slot.endsAt && slot.startsAt < other.endsAt);
}

/** The worker's live slots overlapping `slot`, other than the ones named in `ignore`. */
export async function clashesFor(
  tx: ShiftScheduleTransaction,
  slot: ShiftSlot,
  ignore: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  const live = await tx.listLiveOverlapping(slot.clientId, slot.userId, slot.startsAt, slot.endsAt);
  return overlapsAny(
    slot,
    live.filter((other) => !ignore.has(other.id)),
  );
}

export function overlapError(): ShiftScheduleError {
  return new ShiftScheduleError('SLOT_OVERLAP', 'The worker already has a slot at that time.');
}

function priorOf(slot: ShiftSlot): ShiftSlotPrior {
  return {
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    userId: slot.userId,
    seriesId: slot.seriesId,
    originSeriesId: slot.originSeriesId,
    detached: slot.detached,
    breakOffsetMinutes: slot.breakOffsetMinutes,
    breakMinutes: slot.breakMinutes,
  };
}

export function slotStamp(slot: ShiftSlot): string {
  return JSON.stringify([priorOf(slot), slot.canceledAt?.toISOString() ?? null]);
}

export function seriesStamp(series: ShiftSlotSeries): string {
  return JSON.stringify([series.endsOn, series.canceledFrom, series.endsOnBeforeCancel]);
}

/** Collects what a write did; `seal` stamps every row and rule it names, as stored now. */
export class ChangeBuilder {
  readonly change: ScheduleChange = {
    createdSlotIds: [],
    canceledSlotIds: [],
    createdSeriesIds: [],
    closedSeries: [],
    editedSlots: [],
    stamps: { slots: {}, series: {} },
  };

  created(slots: readonly ShiftSlot[]): this {
    this.change.createdSlotIds.push(...slots.map((slot) => slot.id));
    return this;
  }

  canceled(slots: readonly ShiftSlot[]): this {
    this.change.canceledSlotIds.push(...slots.map((slot) => slot.id));
    return this;
  }

  edited(before: ShiftSlot): this {
    if (!this.change.editedSlots.some((entry) => entry.id === before.id)) {
      this.change.editedSlots.push({ id: before.id, prior: priorOf(before) });
    }
    return this;
  }

  createdSeries(series: ShiftSlotSeries): this {
    this.change.createdSeriesIds.push(series.id);
    return this;
  }

  closedSeries(before: ShiftSlotSeries): this {
    if (!this.change.closedSeries.some((entry) => entry.id === before.id)) {
      this.change.closedSeries.push({
        id: before.id,
        priorEndsOn: before.endsOn,
        priorCanceledFrom: before.canceledFrom,
        priorEndsOnBeforeCancel: before.endsOnBeforeCancel,
      });
    }
    return this;
  }

  async seal(tx: ShiftScheduleTransaction, clientId: string): Promise<ScheduleChange> {
    const { change } = this;
    const slotIds = new Set([
      ...change.createdSlotIds,
      ...change.canceledSlotIds,
      ...change.editedSlots.map((entry) => entry.id),
    ]);
    for (const id of slotIds) {
      const slot = await tx.getSlot(clientId, id);
      if (slot) change.stamps.slots[id] = slotStamp(slot);
    }
    const seriesIds = new Set([...change.createdSeriesIds, ...change.closedSeries.map((entry) => entry.id)]);
    for (const id of seriesIds) {
      const series = await tx.getSeries(clientId, id);
      if (series) change.stamps.series[id] = seriesStamp(series);
    }
    return change;
  }
}
