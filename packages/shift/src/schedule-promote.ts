/**
 * Turning single slots into a series (`promoteToSeries`) and a series back
 * into one slot (`demoteToSlot`).
 */
import { ChangeBuilder, invalid, requireText, type ScheduleContext } from './schedule-context';
import { editableSlot, lockUsers } from './schedule-edit';
import { ShiftScheduleError } from './schedule-errors';
import { occurrencesBetween, ruleAuditFields } from './schedule-rule';
import { newRule, todayIn, writeRule } from './schedule-series';
import type { DemoteToSlotInput, PromoteToSeriesInput, ScheduleWriteResult, ShiftSlotSeries } from './schedule-series-types';
import { addLocalDays, isKnownTimeZone, isLocalDate, isoWeekday, zonedParts, type LocalDate } from './schedule-time';
import type { ShiftScheduleTransaction, ShiftSlot } from './schedule-types';

const EARLIEST = new Date(0);

function sameShape(slots: readonly ShiftSlot[], timeZone: string): void {
  const shape = (slot: ShiftSlot): string =>
    JSON.stringify([
      slot.userId,
      slot.kind,
      zonedParts(slot.startsAt, timeZone).minutes,
      zonedParts(slot.endsAt, timeZone).minutes,
      slot.breakOffsetMinutes,
      slot.breakMinutes,
      slot.resourceType,
      slot.resourceId,
    ]);
  const first = shape(slots[0] as ShiftSlot);
  if (slots.some((slot) => slot.seriesId !== null)) throw invalid('Only single slots are promoted to a series.');
  if (slots.some((slot) => shape(slot) !== first)) {
    throw invalid('The slots promoted together are one person’s, of one kind, at the same hours and break.');
  }
}

async function promotable(ctx: ScheduleContext, tx: ShiftScheduleTransaction, input: PromoteToSeriesInput): Promise<ShiftSlot[]> {
  const now = ctx.now();
  const slots: ShiftSlot[] = [];
  for (const id of input.slotIds) {
    const slot = await editableSlot(tx, input.clientId, id, now);
    // Canceled and rebuilt by the rule, a slot under way would be lost: the rule builds no started day.
    if (slot.startsAt.getTime() < now.getTime()) throw invalid('A slot already under way cannot be promoted.');
    slots.push(slot);
  }
  sameShape(slots, input.rule.timeZone);
  return slots;
}

/** Every single's day must be a day of the rule: canceled, a day it does not build would simply be lost. */
function refuseOffRuleDays(rule: ShiftSlotSeries, dates: readonly LocalDate[]): void {
  const days = new Set(occurrencesBetween(rule, dates[0] as LocalDate, dates[dates.length - 1] as LocalDate));
  const off = dates.filter((date) => !days.has(date));
  if (off.length > 0) throw invalid(`The rule does not fall on ${off.join(', ')}: those slots cannot be promoted to it.`);
}

export async function promoteToSeries(ctx: ScheduleContext, input: PromoteToSeriesInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.actorUserId, 'actorUserId');
  if (input.slotIds.length === 0 || new Set(input.slotIds).size !== input.slotIds.length) {
    throw invalid('slotIds must name each slot once, and at least one.');
  }
  if (!isKnownTimeZone(input.rule.timeZone)) throw invalid('A series needs a known timeZone.');
  return ctx.db.transaction(async (tx) => {
    const found = await promotable(ctx, tx, input);
    await lockUsers(tx, input.clientId, found.map((slot) => slot.userId));
    const slots = await promotable(ctx, tx, input);
    const first = slots[0] as ShiftSlot;
    const { timeZone } = input.rule;
    const dates = slots.map((slot) => zonedParts(slot.startsAt, timeZone).date).sort();
    const rule = newRule(ctx, {
      clientId: input.clientId,
      userId: first.userId,
      kind: first.kind,
      weekdays: [...new Set(dates.map(isoWeekday))],
      everyWeeks: input.rule.everyWeeks,
      monthlyNth: input.rule.monthlyNth,
      startMinutes: zonedParts(first.startsAt, timeZone).minutes,
      endMinutes: zonedParts(first.endsAt, timeZone).minutes,
      breakOffsetMinutes: first.breakOffsetMinutes,
      breakMinutes: first.breakMinutes,
      timeZone,
      startsOn: dates[0] as LocalDate,
      endsOn: input.rule.endsOn ?? null,
      resource: first.resourceType !== null && first.resourceId !== null ? { type: first.resourceType, id: first.resourceId } : null,
      coverage: first.coverage,
      actorUserId: input.actorUserId,
    });
    refuseOffRuleDays(rule, dates);
    const builder = new ChangeBuilder();
    // A slot is a plan: the singles are canceled, and the rule builds their days again as its own.
    const canceled = await tx.cancelSlots({
      clientId: input.clientId,
      slotIds: slots.map((slot) => slot.id),
      canceledAt: ctx.now(),
      canceledByUserId: input.actorUserId,
      cancelReason: 'promoted',
    });
    builder.canceled(canceled);
    const built = await writeRule(ctx, tx, rule, builder);
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.promote',
      resourceType: 'shift_slot_series',
      resourceId: rule.id,
      before: {},
      after: { ...ruleAuditFields(rule), promoted: String(canceled.length), count: String(built.length) },
    });
    for (const slot of canceled) {
      await tx.writeAudit({
        clientId: input.clientId,
        actorUserId: input.actorUserId,
        action: 'shift.schedule.promote',
        resourceType: 'shift_slot',
        resourceId: slot.id,
        before: { seriesId: null },
        after: { seriesId: rule.id, reason: 'promoted' },
      });
    }
    return { slots: built, series: rule, change: await builder.seal(tx, input.clientId) };
  });
}

async function demoteParts(
  ctx: ScheduleContext,
  tx: ShiftScheduleTransaction,
  input: DemoteToSlotInput,
): Promise<{ keep: ShiftSlot; others: ShiftSlot[]; userId: string }> {
  const rule = await tx.getSeries(input.clientId, input.seriesId);
  const timeZone = rule?.timeZone ?? input.timeZone;
  if (timeZone === undefined) throw invalid('A series written before rules needs a timeZone.');
  const now = ctx.now();
  const rows = await tx.listSeriesFrom(input.clientId, input.seriesId, EARLIEST);
  if (!rule && rows.length === 0) throw new ShiftScheduleError('SERIES_NOT_FOUND', 'Series not found.');
  const keep = rows.find(
    (row) =>
      (row.seriesDate ?? zonedParts(row.startsAt, timeZone).date) === input.keepDate && row.endsAt.getTime() > now.getTime(),
  );
  if (!keep) throw new ShiftScheduleError('SLOT_NOT_FOUND', 'The series has no slot still ahead on that day.');
  const others = rows.filter((row) => row.id !== keep.id && row.startsAt.getTime() >= now.getTime());
  return { keep, others, userId: rule?.userId ?? keep.userId };
}

export async function demoteToSlot(ctx: ScheduleContext, input: DemoteToSlotInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.seriesId, 'seriesId');
  requireText(input.actorUserId, 'actorUserId');
  if (!isLocalDate(input.keepDate)) throw invalid('keepDate must be a YYYY-MM-DD date.');
  return ctx.db.transaction(async (tx) => {
    const found = await demoteParts(ctx, tx, input);
    await lockUsers(tx, input.clientId, [found.userId]);
    const { keep, others } = await demoteParts(ctx, tx, input);
    const builder = new ChangeBuilder();
    const canceled = await tx.cancelSlots({
      clientId: input.clientId,
      slotIds: others.map((row) => row.id),
      canceledAt: ctx.now(),
      canceledByUserId: input.actorUserId,
      cancelReason: 'demoted',
    });
    builder.canceled(canceled).edited(keep);
    const rule = await tx.getSeries(input.clientId, input.seriesId);
    if (rule) {
      const yesterday = addLocalDays(todayIn(ctx, rule.timeZone), -1);
      const endsOn = rule.endsOn !== null && rule.endsOn < yesterday ? rule.endsOn : yesterday;
      builder.closedSeries(rule);
      await tx.updateSeries(rule.clientId, rule.id, { endsOn });
      await tx.writeAudit({
        clientId: input.clientId,
        actorUserId: input.actorUserId,
        action: 'shift.schedule.demote',
        resourceType: 'shift_slot_series',
        resourceId: rule.id,
        before: { endsOn: rule.endsOn },
        after: { endsOn, canceled: String(canceled.length), keptSlotId: keep.id },
      });
    }
    const kept = await tx.updateSlot(input.clientId, keep.id, {
      seriesId: null,
      originSeriesId: input.seriesId,
      detached: true,
    });
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.demote',
      resourceType: 'shift_slot',
      resourceId: keep.id,
      before: { seriesId: keep.seriesId, detached: String(keep.detached) },
      after: { seriesId: null, originSeriesId: input.seriesId, detached: 'true' },
    });
    return { slots: [kept], series: null, change: await builder.seal(tx, input.clientId) };
  });
}
