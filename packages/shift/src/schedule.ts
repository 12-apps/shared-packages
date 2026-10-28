import { randomUUID } from 'node:crypto';

import { ShiftConfigError } from './errors';
import {
  ChangeBuilder,
  MAX_SLOT_MS,
  MINUTE_MS,
  invalid,
  overlapError,
  refusePastStart,
  resourceFields,
  validateWho,
  requireText,
  validateBreak,
  type ScheduleContext,
} from './schedule-context';
import { demoteToSlot, promoteToSeries } from './schedule-promote';
import { editSeries, editSlot } from './schedule-edit';
import { ShiftScheduleError } from './schedule-errors';
import { restoreSlot, revertScheduleChange } from './schedule-revert';
import { extendSeries, materialiseSeries, scheduleSeries } from './schedule-series';
import { slotStandingAt } from './schedule-standing';
import { addLocalDays, addZonedDays, isKnownTimeZone, zonedParts } from './schedule-time';
import type {
  CancelSlotInput,
  CancelSlotResult,
  ListSlotsInput,
  NextSlotsInput,
  ScheduleSlotInput,
  ShiftScheduleDb,
  ShiftScheduleService,
  ShiftScheduleServiceOptions,
  ShiftScheduleTransaction,
  ShiftSlot,
} from './schedule-types';
import type { ScheduleChange } from './schedule-series-types';
import { defineShiftVocabulary, type ShiftKindTuple } from './vocabulary';

const WEEK_DAYS = 7;
const DEFAULT_MAX_REPEAT_WEEKS = 12;
const DEFAULT_DUE_WINDOW_MINUTES = 15;
const DEFAULT_HORIZON_WEEKS = 12;

function validateTimes(input: ScheduleSlotInput, now: Date): void {
  const start = input.startsAt.getTime();
  const end = input.endsAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw invalid('startsAt and endsAt must be valid dates.');
  if (end <= start) throw invalid('endsAt must be after startsAt.');
  if (end - start > MAX_SLOT_MS) throw invalid('A slot may last at most 24 hours.');
  refusePastStart(input.startsAt, input.endsAt, now, input.allowRunning);
  validateBreak(input.breakOffsetMinutes, input.breakMinutes, (end - start) / MINUTE_MS);
}

function validateRepeat(input: ScheduleSlotInput, maxRepeatWeeks: number): number {
  const weeks = input.repeatWeeks ?? 0;
  if (!Number.isInteger(weeks) || weeks < 0 || weeks > maxRepeatWeeks) {
    throw invalid(`repeatWeeks must be a whole number from 0 to ${maxRepeatWeeks}.`);
  }
  if (weeks > 0 && (input.timeZone === undefined || !isKnownTimeZone(input.timeZone))) {
    throw invalid('A repeated slot needs a known timeZone.');
  }
  return weeks;
}

function validateInput(ctx: ScheduleContext, input: ScheduleSlotInput): number {
  validateWho(ctx, input);
  validateTimes(input, ctx.now());
  return validateRepeat(input, ctx.maxRepeatWeeks);
}

/** The fields every copy of the input shares, optional ones defaulted. */
function sharedFields(input: ScheduleSlotInput) {
  return {
    ...resourceFields(input),
    breakOffsetMinutes: input.breakOffsetMinutes ?? null,
    breakMinutes: input.breakMinutes ?? null,
  };
}

/** The slot and each weekly repeat, keeping wall-clock time in the input's zone. */
function buildSlots(ctx: ScheduleContext, input: ScheduleSlotInput, weeks: number): ShiftSlot[] {
  const createdAt = ctx.now();
  const seriesId = weeks > 0 ? ctx.createId() : null;
  const shared = sharedFields(input);
  return Array.from({ length: weeks + 1 }, (_, week) => {
    const days = week * WEEK_DAYS;
    const zone = input.timeZone ?? 'UTC';
    return {
      id: ctx.createId(),
      clientId: input.clientId,
      userId: input.userId,
      kind: input.kind,
      startsAt: week === 0 ? new Date(input.startsAt) : addZonedDays(input.startsAt, days, zone),
      endsAt: week === 0 ? new Date(input.endsAt) : addZonedDays(input.endsAt, days, zone),
      ...shared,
      seriesId,
      originSeriesId: null,
      seriesDate: null,
      detached: false,
      createdByUserId: input.actorUserId,
      createdAt,
      canceledAt: null,
      canceledByUserId: null,
      cancelReason: null,
    };
  });
}

/** Each built slot, not just the first: a repeat across a fall-back day is an hour longer. */
function validateBuilt(slots: readonly ShiftSlot[]): void {
  slots.forEach((slot, week) => {
    const length = slot.endsAt.getTime() - slot.startsAt.getTime();
    if (!(length > 0) || length > MAX_SLOT_MS) {
      throw invalid(`The repeat in week ${week} would not last between 0 and 24 hours in that time zone.`);
    }
    validateBreak(slot.breakOffsetMinutes, slot.breakMinutes, length / MINUTE_MS);
  });
}

async function refuseOverlap(tx: ShiftScheduleTransaction, slots: readonly ShiftSlot[]): Promise<void> {
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return;
  const live = await tx.listLiveOverlapping(first.clientId, first.userId, first.startsAt, last.endsAt);
  const clash = slots.find((slot) =>
    live.some((other) => other.startsAt < slot.endsAt && slot.startsAt < other.endsAt),
  );
  if (clash) throw overlapError();
}

async function scheduleSlot(ctx: ScheduleContext, input: ScheduleSlotInput): Promise<ShiftSlot[]> {
  const weeks = validateInput(ctx, input);
  const slots = buildSlots(ctx, input, weeks);
  validateBuilt(slots);
  const first = slots[0] as ShiftSlot;
  return ctx.db.transaction(async (tx) => {
    await tx.lockUserSchedule(input.clientId, input.userId);
    await refuseOverlap(tx, slots);
    await tx.createSlots(slots);
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule',
      resourceType: 'shift_slot',
      resourceId: first.id,
      before: {},
      after: {
        userId: input.userId,
        kind: input.kind,
        startsAt: first.startsAt.toISOString(),
        endsAt: first.endsAt.toISOString(),
        seriesId: first.seriesId,
        breakOffsetMinutes: first.breakOffsetMinutes === null ? null : String(first.breakOffsetMinutes),
        breakMinutes: first.breakMinutes === null ? null : String(first.breakMinutes),
        count: String(slots.length),
      },
    });
    return slots;
  });
}

async function slotToCancel(tx: ShiftScheduleTransaction, input: CancelSlotInput, now: Date): Promise<ShiftSlot> {
  const slot = await tx.getSlot(input.clientId, input.slotId);
  if (!slot) throw new ShiftScheduleError('SLOT_NOT_FOUND', 'Slot not found.');
  if (slot.canceledAt !== null) throw new ShiftScheduleError('SLOT_CANCELED', 'The slot is already canceled.');
  if (slot.endsAt.getTime() <= now.getTime()) throw new ShiftScheduleError('SLOT_OVER', 'The slot is already over.');
  return slot;
}

/**
 * A `following` cancel on a rule's row ends the rule the day before, so the
 * extension builds no more days; the end it had is kept for `restoreSlot`.
 */
async function endRuleFrom(
  tx: ShiftScheduleTransaction,
  slot: ShiftSlot,
  actorUserId: string | null,
  builder: ChangeBuilder,
): Promise<void> {
  const rule = slot.seriesId === null ? null : await tx.getSeries(slot.clientId, slot.seriesId);
  if (!rule) return;
  const from = slot.seriesDate ?? zonedParts(slot.startsAt, rule.timeZone).date;
  const endsOn = addLocalDays(from, -1);
  if (rule.endsOn !== null && rule.endsOn <= endsOn) return;
  builder.closedSeries(rule);
  await tx.updateSeries(rule.clientId, rule.id, { endsOn, canceledFrom: from, endsOnBeforeCancel: rule.endsOn });
  await tx.writeAudit({
    clientId: rule.clientId,
    actorUserId,
    action: 'shift.schedule.series',
    resourceType: 'shift_slot_series',
    resourceId: rule.id,
    before: { endsOn: rule.endsOn },
    after: { endsOn, canceledFrom: from },
  });
}

function withChange(slots: ShiftSlot[], change: ScheduleChange): CancelSlotResult {
  // Not enumerable: the array still reads, compares and serialises as the slots it was.
  return Object.defineProperty(slots, 'change', { value: change, enumerable: false }) as CancelSlotResult;
}

async function cancelSlot(ctx: ScheduleContext, input: CancelSlotInput): Promise<CancelSlotResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.slotId, 'slotId');
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const found = await slotToCancel(tx, input, now);
    await tx.lockUserSchedule(found.clientId, found.userId);
    // Again under the lock: a concurrent cancel may have won while we waited.
    const slot = await slotToCancel(tx, input, now);
    const following =
      input.scope === 'following' && slot.seriesId !== null
        ? await tx.listSeriesFrom(slot.clientId, slot.seriesId, slot.startsAt)
        : [];
    const ids = [...new Set([slot.id, ...following.map((other) => other.id)])];
    const canceled = await tx.cancelSlots({
      clientId: slot.clientId,
      slotIds: ids,
      canceledAt: now,
      canceledByUserId: input.actorUserId,
      cancelReason: input.reason ?? null,
    });
    const builder = new ChangeBuilder().canceled(canceled);
    if (input.scope === 'following') await endRuleFrom(tx, slot, input.actorUserId, builder);
    await tx.writeAudit({
      clientId: slot.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.cancel',
      resourceType: 'shift_slot',
      resourceId: slot.id,
      before: { startsAt: slot.startsAt.toISOString(), seriesId: slot.seriesId },
      after: { reason: input.reason ?? null, count: String(canceled.length) },
    });
    const sorted = [...canceled].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return withChange(sorted, await builder.seal(tx, slot.clientId));
  });
}

async function nextSlots(ctx: ScheduleContext, input: NextSlotsInput): Promise<ShiftSlot[]> {
  if (input.clientIds.length === 0) throw invalid('clientIds must name at least one tenant.');
  requireText(input.userId, 'userId');
  if (!Number.isInteger(input.limit) || input.limit < 1) throw invalid('limit must be a positive whole number.');
  return ctx.db.listUpcoming({
    clientIds: input.clientIds,
    userId: input.userId,
    after: ctx.now(),
    limit: input.limit,
  });
}

function listSlots(ctx: ScheduleContext, input: ListSlotsInput): Promise<ShiftSlot[]> {
  requireText(input.clientId, 'clientId');
  const from = input.from.getTime();
  const to = input.to.getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw invalid('to must be a valid date after from.');
  return ctx.db.listSlots(input);
}

/**
 * The schedule of planned shift slots — see `ShiftSlot`. Built beside
 * `createShiftService`, on the same vocabulary, over its own db seam.
 */
/** The numeric options, defaulted and checked where a wiring mistake is legible. */
function resolveOptions(options: ShiftScheduleServiceOptions): Pick<ScheduleContext, 'maxRepeatWeeks' | 'dueWindowMinutes' | 'horizonWeeks'> {
  const maxRepeatWeeks = options.maxRepeatWeeks ?? DEFAULT_MAX_REPEAT_WEEKS;
  const dueWindowMinutes = options.dueWindowMinutes ?? DEFAULT_DUE_WINDOW_MINUTES;
  const horizonWeeks = options.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  if (!Number.isInteger(maxRepeatWeeks) || maxRepeatWeeks < 0) {
    throw new ShiftConfigError('maxRepeatWeeks must be a whole number of weeks, 0 or more.');
  }
  if (!Number.isFinite(dueWindowMinutes) || dueWindowMinutes < 0) {
    throw new ShiftConfigError('dueWindowMinutes must be a number of minutes, 0 or more.');
  }
  if (!Number.isInteger(horizonWeeks) || horizonWeeks < 1) {
    throw new ShiftConfigError('horizonWeeks must be a whole number of weeks, 1 or more.');
  }
  return { maxRepeatWeeks, dueWindowMinutes, horizonWeeks };
}

export function createShiftScheduleService<const Kinds extends ShiftKindTuple>(
  db: ShiftScheduleDb,
  options: ShiftScheduleServiceOptions<Kinds>,
): ShiftScheduleService<Kinds[number]> {
  const ctx: ScheduleContext = {
    db,
    vocabulary: defineShiftVocabulary(options.kinds),
    now: options.now ?? (() => new Date()),
    createId: options.createId ?? randomUUID,
    ...resolveOptions(options),
  };
  return {
    scheduleSlot: (input) => scheduleSlot(ctx, input),
    cancelSlot: (input) => cancelSlot(ctx, input),
    listSlots: (input) => listSlots(ctx, input),
    nextSlots: (input) => nextSlots(ctx, input),
    scheduleSeries: (input) => scheduleSeries(ctx, input),
    extendSeries: (now) => extendSeries(now === undefined ? ctx : { ...ctx, now: () => now }),
    materialiseSeries: (input) => materialiseSeries(ctx, input),
    editSlot: (input) => editSlot(ctx, input),
    editSeries: (input) => editSeries(ctx, input),
    promoteToSeries: (input) => promoteToSeries(ctx, input),
    demoteToSlot: (input) => demoteToSlot(ctx, input),
    restoreSlot: (input) => restoreSlot(ctx, input),
    revertScheduleChange: (input) => revertScheduleChange(ctx, input),
    slotStanding: (input) =>
      slotStandingAt({ ...input, now: input.now ?? ctx.now() }, ctx.dueWindowMinutes),
  };
}
