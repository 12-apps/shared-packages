/**
 * Series rules: writing one, and building its days — on the write, by the
 * daily extension up to the horizon, and on demand past it.
 */
import {
  ChangeBuilder,
  clashesFor,
  invalid,
  overlapError,
  requireText,
  resourceFields,
  slotIsStorable,
  validateWho,
  type ScheduleContext,
} from './schedule-context';
import { ShiftScheduleError } from './schedule-errors';
import { buildRuleSlot, occurrencesBetween, repeatOf, ruleAuditFields, validateRule } from './schedule-rule';
import type {
  ExtendSeriesResult,
  MaterialiseSeriesInput,
  MaterialiseSeriesResult,
  ScheduleSeriesInput,
  ScheduleWriteResult,
  ShiftSlotSeries,
} from './schedule-series-types';
import { addLocalDays, isLocalDate, zonedInstant, zonedParts, type LocalDate } from './schedule-time';
import type { ShiftScheduleTransaction, ShiftSlot } from './schedule-types';

interface MaterialiseOptions {
  from: LocalDate;
  until: LocalDate;
  /** `refuse` throws on a taken or unbuildable day (a write); `skip` records it on the rule (the job). */
  onConflict: 'refuse' | 'skip';
  preview?: boolean;
}

interface MaterialiseOutcome {
  built: ShiftSlot[];
  skipped: LocalDate[];
}

export function todayIn(ctx: ScheduleContext, timeZone: string): LocalDate {
  return zonedParts(ctx.now(), timeZone).date;
}

/** The last day the horizon covers, counted from `today`. */
function horizonEnd(ctx: ScheduleContext, today: LocalDate): LocalDate {
  return addLocalDays(today, ctx.horizonWeeks * 7 - 1);
}

const LATEST = new Date(8.64e15);

/**
 * The days the rule already has a row for — canceled, handed out or moved
 * included. Keyed by the day each row was BUILT for, so the window is read by
 * start wide on both sides: a row is built at most a horizon ahead of its day
 * and may be moved to any later date.
 */
async function existingDays(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  dates: readonly LocalDate[],
): Promise<Set<LocalDate>> {
  const first = dates[0] as LocalDate;
  const last = dates[dates.length - 1] as LocalDate;
  const from = zonedInstant(addLocalDays(first, -(ctx.horizonWeeks * 7 + 2)), 0, rule.timeZone);
  const rows = await tx.listSeriesRows(rule.clientId, rule.id, from, LATEST);
  const key = (row: ShiftSlot): LocalDate => row.seriesDate ?? zonedParts(row.startsAt, rule.timeZone).date;
  return new Set(rows.map(key).filter((day) => day >= first && day <= last));
}

/** A clash with a live slot of the person, or with a day built a moment ago. */
async function isTaken(tx: ShiftScheduleTransaction, slot: ShiftSlot, built: readonly ShiftSlot[]): Promise<boolean> {
  if (built.some((other) => other.startsAt < slot.endsAt && slot.startsAt < other.endsAt)) return true;
  return clashesFor(tx, slot);
}

/** One missing day: built, refused, or recorded as skipped. A day already started is left alone. */
async function placeDay(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  date: LocalDate,
  options: MaterialiseOptions,
  outcome: MaterialiseOutcome,
): Promise<void> {
  const now = ctx.now();
  const slot = buildRuleSlot(rule, date, ctx.createId(), now);
  if (slot.startsAt.getTime() < now.getTime()) return;
  const storable = slotIsStorable(slot);
  if (storable && !(await isTaken(tx, slot, outcome.built))) {
    outcome.built.push(slot);
  } else if (options.onConflict === 'refuse') {
    throw storable ? overlapError() : invalid(`The series cannot be planned on ${date} in its time zone.`);
  } else {
    outcome.skipped.push(date);
  }
}

/**
 * Build the rule's missing days in `[from, until]`. A day with a row of the
 * rule is never rebuilt, so a canceled day stays canceled; a day already
 * started is left alone.
 */
async function materialiseRule(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  options: MaterialiseOptions,
): Promise<MaterialiseOutcome> {
  const outcome: MaterialiseOutcome = { built: [], skipped: [] };
  const dates = occurrencesBetween(rule, options.from, options.until);
  if (dates.length === 0) return outcome;
  const existing = await existingDays(ctx, tx, rule, dates);
  for (const date of dates.filter((day) => !existing.has(day))) {
    await placeDay(ctx, tx, rule, date, options, outcome);
  }
  if (options.preview === true) return outcome;
  if (outcome.built.length > 0) await tx.createSlots(outcome.built);
  if (outcome.skipped.length > 0) {
    await tx.updateSeries(rule.clientId, rule.id, { skippedDates: [...rule.skippedDates, ...outcome.skipped] });
  }
  return outcome;
}

/** Audit what the extension built or skipped on one rule — no row when it did nothing. */
async function auditMaterialised(
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  outcome: MaterialiseOutcome,
  actorUserId: string | null,
): Promise<void> {
  if (outcome.built.length === 0 && outcome.skipped.length === 0) return;
  await tx.writeAudit({
    clientId: rule.clientId,
    actorUserId,
    action: 'shift.schedule.series',
    resourceType: 'shift_slot_series',
    resourceId: rule.id,
    before: {},
    after: { built: String(outcome.built.length), skipped: outcome.skipped.length > 0 ? outcome.skipped.join(',') : null },
  });
}

/** The fields a caller may leave out, defaulted to "none". */
function optionalRuleFields(input: ScheduleSeriesInput) {
  return {
    endsOn: input.endsOn ?? null,
    breakOffsetMinutes: input.breakOffsetMinutes ?? null,
    breakMinutes: input.breakMinutes ?? null,
    ...resourceFields(input),
  };
}

export function newRule(
  ctx: ScheduleContext,
  input: ScheduleSeriesInput,
  previousSeriesId: string | null = null,
): ShiftSlotSeries {
  validateWho(ctx, input);
  const rule: ShiftSlotSeries = {
    id: ctx.createId(),
    clientId: input.clientId,
    userId: input.userId,
    kind: input.kind,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
    ...repeatOf(input),
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    timeZone: input.timeZone,
    startsOn: input.startsOn,
    skippedDates: [],
    previousSeriesId,
    canceledFrom: null,
    endsOnBeforeCancel: null,
    ...optionalRuleFields(input),
    createdByUserId: input.actorUserId,
    createdAt: ctx.now(),
  };
  validateRule(rule);
  if (rule.endsOn !== null && rule.endsOn < rule.startsOn) throw invalid('endsOn may not be before startsOn.');
  if (rule.startsOn < todayIn(ctx, rule.timeZone)) throw invalid('A series may not start in the past.');
  return rule;
}

/**
 * Write a rule and build its first days, inside one transaction: a rule whose
 * first weeks clash with the person's other slots is refused whole.
 */
export async function writeRule(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  rule: ShiftSlotSeries,
  builder: ChangeBuilder,
): Promise<ShiftSlot[]> {
  await tx.createSeries(rule);
  const today = todayIn(ctx, rule.timeZone);
  const { built } = await materialiseRule(ctx, tx, rule, {
    from: rule.startsOn,
    until: horizonEnd(ctx, today),
    onConflict: 'refuse',
  });
  builder.createdSeries(rule).created(built);
  return built;
}

export async function scheduleSeries(ctx: ScheduleContext, input: ScheduleSeriesInput): Promise<ScheduleWriteResult> {
  const rule = newRule(ctx, input);
  return ctx.db.transaction(async (tx) => {
    await tx.lockUserSchedule(rule.clientId, rule.userId);
    const builder = new ChangeBuilder();
    const slots = await writeRule(ctx, tx, rule, builder);
    await tx.writeAudit({
      clientId: rule.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.series',
      resourceType: 'shift_slot_series',
      resourceId: rule.id,
      before: {},
      after: { ...ruleAuditFields(rule), count: String(slots.length) },
    });
    return { slots, series: rule, change: await builder.seal(tx, rule.clientId) };
  });
}

async function extendOne(ctx: ScheduleContext, listed: ShiftSlotSeries): Promise<MaterialiseOutcome> {
  return ctx.db.transaction(async (tx) => {
    await tx.lockUserSchedule(listed.clientId, listed.userId);
    // Again under the lock: an edit may have closed the rule since the list.
    const rule = await tx.getSeries(listed.clientId, listed.id);
    if (!rule) return { built: [], skipped: [] };
    const today = todayIn(ctx, rule.timeZone);
    const outcome = await materialiseRule(ctx, tx, rule, { from: today, until: horizonEnd(ctx, today), onConflict: 'skip' });
    await auditMaterialised(tx, rule, outcome, null);
    return outcome;
  });
}

export async function extendSeries(ctx: ScheduleContext): Promise<ExtendSeriesResult> {
  const result: ExtendSeriesResult = { built: [], skipped: [], failures: [] };
  // A day of slack: a rule ending "yesterday" in UTC may end today in its zone.
  const rules = await ctx.db.listOpenSeries(addLocalDays(ctx.now().toISOString().slice(0, 10), -1));
  for (const rule of rules) {
    const key = { clientId: rule.clientId, seriesId: rule.id };
    try {
      const outcome = await extendOne(ctx, rule);
      if (outcome.built.length > 0) result.built.push({ ...key, slotIds: outcome.built.map((slot) => slot.id) });
      result.skipped.push(...outcome.skipped.map((date) => ({ ...key, date })));
    } catch (error) {
      result.failures.push({ ...key, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function materialiseSeries(
  ctx: ScheduleContext,
  input: MaterialiseSeriesInput,
): Promise<MaterialiseSeriesResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.seriesId, 'seriesId');
  if (!isLocalDate(input.until)) throw invalid('until must be a YYYY-MM-DD date.');
  return ctx.db.transaction(async (tx) => {
    const found = await tx.getSeries(input.clientId, input.seriesId);
    if (!found) throw new ShiftScheduleError('SERIES_NOT_FOUND', 'Series not found.');
    await tx.lockUserSchedule(found.clientId, found.userId);
    const rule = (await tx.getSeries(input.clientId, input.seriesId)) ?? found;
    const outcome = await materialiseRule(ctx, tx, rule, {
      from: todayIn(ctx, rule.timeZone),
      until: input.until,
      onConflict: 'skip',
      preview: input.preview === true,
    });
    if (input.preview !== true) await auditMaterialised(tx, rule, outcome, null);
    return {
      dates: outcome.built.map((slot) => slot.seriesDate as LocalDate),
      slotIds: input.preview === true ? [] : outcome.built.map((slot) => slot.id),
      skippedDates: outcome.skipped,
    };
  });
}
