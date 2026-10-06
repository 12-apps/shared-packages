import { randomUUID } from 'node:crypto';

import { ShiftScheduleError } from './schedule-errors';
import { slotStandingAt } from './schedule-standing';
import { addZonedDays, isKnownTimeZone } from './schedule-time';
import type {
  CancelSlotInput,
  ListSlotsInput,
  NextSlotsInput,
  ScheduleSlotInput,
  ShiftScheduleDb,
  ShiftScheduleService,
  ShiftScheduleServiceOptions,
  ShiftScheduleTransaction,
  ShiftSlot,
} from './schedule-types';
import { defineShiftVocabulary, type ShiftKindTuple, type ShiftVocabulary } from './vocabulary';

const DAY_MS = 24 * 60 * 60_000;
const WEEK_DAYS = 7;
/** A slot longer than a day is a typo, not a plan. */
const MAX_SLOT_MS = DAY_MS;
const DEFAULT_MAX_REPEAT_WEEKS = 12;
const DEFAULT_DUE_WINDOW_MINUTES = 15;

interface ScheduleContext {
  db: ShiftScheduleDb;
  vocabulary: ShiftVocabulary<string>;
  now: () => Date;
  createId: () => string;
  maxRepeatWeeks: number;
  dueWindowMinutes: number;
}

function invalid(message: string): ShiftScheduleError {
  return new ShiftScheduleError('INVALID_SLOT', message);
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) throw invalid(`${field} must not be empty.`);
}

function validateTimes(input: ScheduleSlotInput, now: Date): void {
  const start = input.startsAt.getTime();
  const end = input.endsAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw invalid('startsAt and endsAt must be valid dates.');
  if (end <= start) throw invalid('endsAt must be after startsAt.');
  if (end - start > MAX_SLOT_MS) throw invalid('A slot may last at most 24 hours.');
  if (start < now.getTime()) throw invalid('A slot may not start in the past.');
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
  requireText(input.clientId, 'clientId');
  requireText(input.userId, 'userId');
  requireText(input.actorUserId, 'actorUserId');
  if (!ctx.vocabulary.has(input.kind)) throw invalid(`Unknown kind: ${input.kind}.`);
  validateTimes(input, ctx.now());
  return validateRepeat(input, ctx.maxRepeatWeeks);
}

/** The slot and each weekly repeat, keeping wall-clock time in the input's zone. */
function buildSlots(ctx: ScheduleContext, input: ScheduleSlotInput, weeks: number): ShiftSlot[] {
  const createdAt = ctx.now();
  const seriesId = weeks > 0 ? ctx.createId() : null;
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
      resourceType: input.resource?.type ?? null,
      resourceId: input.resource?.id ?? null,
      coverage: input.coverage ? input.coverage.map((entry) => ({ ...entry })) : null,
      seriesId,
      createdByUserId: input.actorUserId,
      createdAt,
      canceledAt: null,
      canceledByUserId: null,
      cancelReason: null,
    };
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
  if (clash) {
    throw new ShiftScheduleError('SLOT_OVERLAP', 'The worker already has a slot at that time.');
  }
}

async function scheduleSlot(ctx: ScheduleContext, input: ScheduleSlotInput): Promise<ShiftSlot[]> {
  const weeks = validateInput(ctx, input);
  const slots = buildSlots(ctx, input, weeks);
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

async function cancelSlot(ctx: ScheduleContext, input: CancelSlotInput): Promise<ShiftSlot[]> {
  requireText(input.clientId, 'clientId');
  requireText(input.slotId, 'slotId');
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const slot = await slotToCancel(tx, input, now);
    await tx.lockUserSchedule(slot.clientId, slot.userId);
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
    await tx.writeAudit({
      clientId: slot.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.cancel',
      resourceType: 'shift_slot',
      resourceId: slot.id,
      before: { startsAt: slot.startsAt.toISOString(), seriesId: slot.seriesId },
      after: { reason: input.reason ?? null, count: String(canceled.length) },
    });
    return canceled;
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
  if (input.to <= input.from) throw invalid('to must be after from.');
  return ctx.db.listSlots(input);
}

/**
 * The schedule of planned shift slots — see `ShiftSlot`. Built beside
 * `createShiftService`, on the same vocabulary, over its own db seam.
 */
export function createShiftScheduleService<const Kinds extends ShiftKindTuple>(
  db: ShiftScheduleDb,
  options: ShiftScheduleServiceOptions<Kinds>,
): ShiftScheduleService<Kinds[number]> {
  const ctx: ScheduleContext = {
    db,
    vocabulary: defineShiftVocabulary(options.kinds),
    now: options.now ?? (() => new Date()),
    createId: options.createId ?? randomUUID,
    maxRepeatWeeks: options.maxRepeatWeeks ?? DEFAULT_MAX_REPEAT_WEEKS,
    dueWindowMinutes: options.dueWindowMinutes ?? DEFAULT_DUE_WINDOW_MINUTES,
  };
  return {
    scheduleSlot: (input) => scheduleSlot(ctx, input),
    cancelSlot: (input) => cancelSlot(ctx, input),
    listSlots: (input) => listSlots(ctx, input),
    nextSlots: (input) => nextSlots(ctx, input),
    slotStanding: (input) =>
      slotStandingAt({ ...input, now: input.now ?? ctx.now() }, ctx.dueWindowMinutes),
  };
}
