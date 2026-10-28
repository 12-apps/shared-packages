/**
 * Editing in place: one slot (`editSlot`), or a series from a day on
 * (`editSeries`, which closes the rule and opens its successor).
 */
import {
  ChangeBuilder,
  MAX_SLOT_MS,
  MINUTE_MS,
  clashesFor,
  invalid,
  overlapError,
  refusePastStart,
  requireText,
  validateBreak,
  type ScheduleContext,
} from './schedule-context';
import { ShiftScheduleError } from './schedule-errors';
import { ruleAuditFields, sameParityStart } from './schedule-rule';
import { newRule, todayIn, writeRule } from './schedule-series';
import type { EditSeriesInput, EditSlotInput, ScheduleWriteResult, ShiftSlotSeries } from './schedule-series-types';
import { addLocalDays, isLocalDate, isoWeekday, wallTimeExists, zonedInstant, zonedParts, type LocalDate } from './schedule-time';
import type { ShiftScheduleTransaction, ShiftSlot, ShiftSlotPatch } from './schedule-types';

const EARLIEST = new Date(0);
const LATEST = new Date(8.64e15);

/** Lock every person a write touches, in one order, so two writers never wait on each other. */
export async function lockUsers(tx: ShiftScheduleTransaction, clientId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) await tx.lockUserSchedule(clientId, userId);
}

/** A live slot still ahead or under way — or the refusal that says why not. */
export async function editableSlot(
  tx: ShiftScheduleTransaction,
  clientId: string,
  slotId: string,
  now: Date,
): Promise<ShiftSlot> {
  const slot = await tx.getSlot(clientId, slotId);
  if (!slot) throw new ShiftScheduleError('SLOT_NOT_FOUND', 'Slot not found.');
  if (slot.canceledAt !== null) throw new ShiftScheduleError('SLOT_CANCELED', 'The slot is canceled.');
  if (slot.endsAt.getTime() <= now.getTime()) throw new ShiftScheduleError('SLOT_OVER', 'The slot is already over.');
  return slot;
}

function slotAuditFields(slot: Pick<ShiftSlot, keyof ShiftSlotPatch>): Record<string, string | null> {
  const text = (value: number | null): string | null => (value === null ? null : String(value));
  return {
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    userId: slot.userId,
    seriesId: slot.seriesId,
    originSeriesId: slot.originSeriesId,
    detached: String(slot.detached),
    breakOffsetMinutes: text(slot.breakOffsetMinutes),
    breakMinutes: text(slot.breakMinutes),
  };
}

/** Only the fields that moved, before and after — the audit row of an in-place edit. */
function changedFields(before: ShiftSlot, after: ShiftSlot): { before: Record<string, string | null>; after: Record<string, string | null> } {
  const was = slotAuditFields(before);
  const is = slotAuditFields(after);
  const keys = Object.keys(is).filter((key) => was[key] !== is[key]);
  return {
    before: { seriesId: before.seriesId, ...Object.fromEntries(keys.map((key) => [key, was[key] ?? null])) },
    after: { seriesId: after.seriesId, ...Object.fromEntries(keys.map((key) => [key, is[key] ?? null])) },
  };
}

function requireWallMinute(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) throw invalid('Hours are whole minutes from 0 to 1439.');
}

/** Refuse hours a spring-forward skips: the slot would silently start or end an hour off. */
function refuseGap(day: LocalDate, from: number, endDay: LocalDate, to: number, timeZone: string): void {
  if (!wallTimeExists(day, from, timeZone) || !wallTimeExists(endDay, to, timeZone)) {
    throw new ShiftScheduleError('WALL_CLOCK_GAP', `Those hours do not exist on ${day} in ${timeZone}.`);
  }
}

/** The slot's new start and end, read on the wall clock of `timeZone`. */
function newTimes(slot: ShiftSlot, input: EditSlotInput, timeZone: string | undefined): { startsAt: Date; endsAt: Date } {
  const { startMinutes, endMinutes, date } = input.patch;
  if ([startMinutes, endMinutes, date].every((value) => value === undefined)) {
    return { startsAt: slot.startsAt, endsAt: slot.endsAt };
  }
  if (timeZone === undefined) throw invalid('Moving a slot that is on no series needs a timeZone.');
  if (date !== undefined && !isLocalDate(date)) throw invalid('date must be a YYYY-MM-DD date.');
  const start = zonedParts(slot.startsAt, timeZone);
  const day = date ?? start.date;
  const from = startMinutes ?? start.minutes;
  const to = endMinutes ?? zonedParts(slot.endsAt, timeZone).minutes;
  requireWallMinute(from);
  requireWallMinute(to);
  const endDay = to > from ? day : addLocalDays(day, 1);
  refuseGap(day, from, endDay, to, timeZone);
  return { startsAt: zonedInstant(day, from, timeZone), endsAt: zonedInstant(endDay, to, timeZone) };
}

/** Whose series a handed-out row may go back to: the rule's person, or — before rules — the series' own. */
async function seriesOwnerIs(tx: ShiftScheduleTransaction, slot: ShiftSlot, origin: string, userId: string): Promise<boolean> {
  const rule = await tx.getSeries(slot.clientId, origin);
  if (rule) return rule.userId === userId;
  const rows = await tx.listSeriesRows(slot.clientId, origin, EARLIEST, LATEST);
  return rows.some((row) => row.seriesId === origin && row.userId === userId);
}

async function seriesFields(
  tx: ShiftScheduleTransaction,
  slot: ShiftSlot,
  input: EditSlotInput,
): Promise<Pick<ShiftSlot, 'userId' | 'seriesId' | 'originSeriesId'>> {
  const userId = input.patch.userId ?? slot.userId;
  requireText(userId, 'userId');
  if (userId === slot.userId) {
    if (input.rejoinSeries === true) throw invalid('rejoinSeries goes with handing the slot to the series’ own person.');
    return { userId, seriesId: slot.seriesId, originSeriesId: slot.originSeriesId };
  }
  if (input.rejoinSeries !== true) {
    // Out of the series: no `following` cancel, no rule edit, no undo of the rule reaches another person's row.
    return { userId, seriesId: null, originSeriesId: slot.seriesId ?? slot.originSeriesId };
  }
  const origin = slot.originSeriesId;
  if (origin === null || !(await seriesOwnerIs(tx, slot, origin, userId))) {
    throw invalid('Only a slot handed out of a series rejoins it, and only to that series’ own person.');
  }
  return { userId, seriesId: origin, originSeriesId: null };
}

/** Hours and break checked against each other; a moved slot may not start in the past. */
function timesAndBreak(ctx: ScheduleContext, slot: ShiftSlot, input: EditSlotInput, timeZone: string | undefined): ShiftSlotPatch {
  const times = newTimes(slot, input, timeZone);
  const moved = times.startsAt.getTime() !== slot.startsAt.getTime() || times.endsAt.getTime() !== slot.endsAt.getTime();
  const length = times.endsAt.getTime() - times.startsAt.getTime();
  if (!(length > 0) || length > MAX_SLOT_MS) throw invalid('A slot may last at most 24 hours.');
  if (moved) refusePastStart(times.startsAt, times.endsAt, ctx.now(), input.allowRunning);
  const { patch } = input;
  const breakOffsetMinutes = patch.breakOffsetMinutes === undefined ? slot.breakOffsetMinutes : patch.breakOffsetMinutes;
  const breakMinutes = patch.breakMinutes === undefined ? slot.breakMinutes : patch.breakMinutes;
  validateBreak(breakOffsetMinutes, breakMinutes, length / MINUTE_MS);
  // Moving the hours or the date detaches the row; handing it over or a break alone does not.
  return { ...times, detached: moved ? true : slot.detached, breakOffsetMinutes, breakMinutes };
}

async function plannedPatch(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  slot: ShiftSlot,
  input: EditSlotInput,
): Promise<ShiftSlotPatch> {
  const ruleId = slot.seriesId ?? slot.originSeriesId;
  const rule = ruleId === null ? null : await tx.getSeries(slot.clientId, ruleId);
  return {
    ...timesAndBreak(ctx, slot, input, input.timeZone ?? rule?.timeZone),
    ...(await seriesFields(tx, slot, input)),
  };
}

export async function editSlot(ctx: ScheduleContext, input: EditSlotInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.slotId, 'slotId');
  requireText(input.actorUserId, 'actorUserId');
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const found = await editableSlot(tx, input.clientId, input.slotId, now);
    await lockUsers(tx, found.clientId, [found.userId, input.patch.userId ?? found.userId]);
    const slot = await editableSlot(tx, input.clientId, input.slotId, now);
    const patch = await plannedPatch(ctx, tx, slot, input);
    if (await clashesFor(tx, { ...slot, ...patch })) throw overlapError();
    const builder = new ChangeBuilder().edited(slot);
    const updated = await tx.updateSlot(slot.clientId, slot.id, patch);
    await tx.writeAudit({
      clientId: slot.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.edit',
      resourceType: 'shift_slot',
      resourceId: slot.id,
      ...changedFields(slot, updated),
    });
    return { slots: [updated], series: null, change: await builder.seal(tx, slot.clientId) };
  });
}

/** A series written before rules, read back as the weekly rule its first row describes. */
async function legacyRule(tx: ShiftScheduleTransaction, input: EditSeriesInput): Promise<ShiftSlotSeries> {
  const rows = (await tx.listSeriesRows(input.clientId, input.seriesId, EARLIEST, LATEST))
    .filter((row) => row.seriesId === input.seriesId)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) throw new ShiftScheduleError('SERIES_NOT_FOUND', 'Series not found.');
  const timeZone = input.timeZone;
  if (timeZone === undefined) throw invalid('A series written before rules needs a timeZone.');
  const start = zonedParts(first.startsAt, timeZone);
  return {
    id: input.seriesId,
    clientId: first.clientId,
    userId: first.userId,
    kind: first.kind,
    weekdays: [isoWeekday(start.date)],
    everyWeeks: 1,
    monthlyNth: null,
    startMinutes: start.minutes,
    endMinutes: zonedParts(first.endsAt, timeZone).minutes,
    breakOffsetMinutes: first.breakOffsetMinutes,
    breakMinutes: first.breakMinutes,
    timeZone,
    startsOn: start.date,
    endsOn: zonedParts(last.startsAt, timeZone).date,
    skippedDates: [],
    previousSeriesId: null,
    canceledFrom: null,
    endsOnBeforeCancel: null,
    resourceType: first.resourceType,
    resourceId: first.resourceId,
    coverage: first.coverage,
    createdByUserId: first.createdByUserId,
    createdAt: first.createdAt,
  };
}

/**
 * The old rule's rows the edit replaces from `from`, and the days the new rule
 * leaves to rows the edit keeps: a hand-edited row, and one already under way.
 * Read by start from a day before `now`, not from `from`: a row built for a
 * later day may have been moved to any day still ahead.
 */
async function rowsFrom(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  from: LocalDate,
): Promise<{ replaced: ShiftSlot[]; keptDays: LocalDate[] }> {
  const now = ctx.now().getTime();
  const rows = await tx.listSeriesRows(rule.clientId, rule.id, new Date(now - MAX_SLOT_MS), LATEST);
  const dayOf = (row: ShiftSlot): LocalDate => row.seriesDate ?? zonedParts(row.startsAt, rule.timeZone).date;
  const live = rows.filter((row) => row.canceledAt === null && row.endsAt.getTime() > now && dayOf(row) >= from);
  const kept = live.filter((row) => row.startsAt.getTime() < now || (row.seriesId === rule.id && row.detached));
  return {
    replaced: live.filter((row) => !kept.includes(row)),
    keptDays: kept.map(dayOf),
  };
}

/** The patch's repeat when it names one, else the rule's own. */
function repeatFor(rule: ShiftSlotSeries, patch: EditSeriesInput['patch']): Pick<ShiftSlotSeries, 'everyWeeks' | 'monthlyNth'> {
  const everyWeeks = patch.everyWeeks ?? null;
  const monthlyNth = patch.monthlyNth ?? null;
  if (everyWeeks === null && monthlyNth === null) return { everyWeeks: rule.everyWeeks, monthlyNth: rule.monthlyNth };
  return { everyWeeks, monthlyNth };
}

function successorOf(ctx: ScheduleContext, rule: ShiftSlotSeries, input: EditSeriesInput): ShiftSlotSeries {
  const { patch } = input;
  const repeat = repeatFor(rule, patch);
  const pick = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
  const next = newRule(
    ctx,
    {
      clientId: rule.clientId,
      userId: pick(patch.userId, rule.userId),
      kind: rule.kind,
      weekdays: pick(patch.weekdays, rule.weekdays),
      ...repeat,
      startMinutes: pick(patch.startMinutes, rule.startMinutes),
      endMinutes: pick(patch.endMinutes, rule.endMinutes),
      breakOffsetMinutes: pick(patch.breakOffsetMinutes, rule.breakOffsetMinutes),
      breakMinutes: pick(patch.breakMinutes, rule.breakMinutes),
      timeZone: rule.timeZone,
      startsOn: input.from,
      endsOn: pick(patch.endsOn, rule.endsOn),
      resource: rule.resourceType !== null && rule.resourceId !== null ? { type: rule.resourceType, id: rule.resourceId } : null,
      coverage: rule.coverage,
      actorUserId: input.actorUserId,
    },
    rule.id,
  );
  const sameRepeat = repeat.everyWeeks === rule.everyWeeks && repeat.monthlyNth === rule.monthlyNth;
  // Validated as starting on `from`; an end before the moved start is a rule with no day, which is allowed.
  return sameRepeat ? { ...next, startsOn: sameParityStart(rule, input.from) } : next;
}

async function closeBefore(
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  from: LocalDate,
  legacy: boolean,
  builder: ChangeBuilder,
): Promise<LocalDate | null> {
  const before = addLocalDays(from, -1);
  const endsOn = rule.endsOn !== null && rule.endsOn < before ? rule.endsOn : before;
  builder.closedSeries(rule);
  if (legacy) await tx.createSeries({ ...rule, endsOn });
  else await tx.updateSeries(rule.clientId, rule.id, { endsOn });
  return endsOn;
}

export async function editSeries(ctx: ScheduleContext, input: EditSeriesInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.seriesId, 'seriesId');
  requireText(input.actorUserId, 'actorUserId');
  if (!isLocalDate(input.from)) throw invalid('from must be a YYYY-MM-DD date.');
  return ctx.db.transaction(async (tx) => {
    const stored = await tx.getSeries(input.clientId, input.seriesId);
    const found = stored ?? (await legacyRule(tx, input));
    await lockUsers(tx, found.clientId, [found.userId, input.patch.userId ?? found.userId]);
    const rule = stored === null ? found : ((await tx.getSeries(input.clientId, input.seriesId)) ?? found);
    if (input.from < todayIn(ctx, rule.timeZone)) throw invalid('A series may not be edited from a day already past.');
    const next = successorOf(ctx, rule, input);
    const builder = new ChangeBuilder();
    const { replaced, keptDays } = await rowsFrom(ctx, tx, rule, input.from);
    const canceled = await tx.cancelSlots({
      clientId: rule.clientId,
      slotIds: replaced.map((row) => row.id),
      canceledAt: ctx.now(),
      canceledByUserId: input.actorUserId,
      cancelReason: 'series-edit',
    });
    builder.canceled(canceled);
    const endsOn = await closeBefore(tx, rule, input.from, stored === null, builder);
    // A day the old rule's hand-edited row still holds is that day's turn: the new rule leaves it.
    const successor = { ...next, skippedDates: [...new Set(keptDays)].sort() };
    const slots = await writeRule(ctx, tx, successor, builder);
    await tx.writeAudit({
      clientId: rule.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.series',
      resourceType: 'shift_slot_series',
      resourceId: rule.id,
      before: { endsOn: rule.endsOn },
      after: { endsOn, canceled: String(canceled.length), nextSeriesId: successor.id },
    });
    await tx.writeAudit({
      clientId: rule.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.series',
      resourceType: 'shift_slot_series',
      resourceId: successor.id,
      before: {},
      after: { ...ruleAuditFields(successor), count: String(slots.length) },
    });
    return { slots, series: successor, change: await builder.seal(tx, rule.clientId) };
  });
}
