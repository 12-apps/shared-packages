/**
 * Putting things back: `restoreSlot` clears a cancel the host allows, and
 * `revertScheduleChange` undoes one write from the change it returned.
 */
import {
  ChangeBuilder,
  clashesFor,
  invalid,
  overlapError,
  requireText,
  seriesStamp,
  slotStamp,
  type ScheduleContext,
} from './schedule-context';
import { lockUsers } from './schedule-edit';
import { ShiftScheduleError } from './schedule-errors';
import type {
  RestoreSlotInput,
  RevertScheduleChangeInput,
  ScheduleChange,
  ScheduleWriteResult,
  ShiftSlotPrior,
  ShiftSlotSeries,
} from './schedule-series-types';
import { addLocalDays, zonedParts } from './schedule-time';
import type { ShiftScheduleTransaction, ShiftSlot, ShiftSlotPatch } from './schedule-types';

const EARLIEST = new Date(0);
const LATEST = new Date(8.64e15);

function notFound(): ShiftScheduleError {
  return new ShiftScheduleError('SLOT_NOT_FOUND', 'Slot not found.');
}

async function restorable(ctx: ScheduleContext, tx: ShiftScheduleTransaction, input: RestoreSlotInput): Promise<ShiftSlot[]> {
  const reasons = new Set(input.restorableReasons);
  const now = ctx.now();
  const slots: ShiftSlot[] = [];
  for (const id of input.slotIds) {
    const slot = await tx.getSlot(input.clientId, id);
    if (!slot) throw notFound();
    if (slot.canceledAt === null || slot.cancelReason === null || !reasons.has(slot.cancelReason)) {
      throw new ShiftScheduleError('SLOT_NOT_RESTORABLE', 'The slot is not canceled for a reason that can be undone.');
    }
    if (slot.endsAt.getTime() <= now.getTime()) throw new ShiftScheduleError('SLOT_OVER', 'The slot is already over.');
    slots.push(slot);
  }
  return slots;
}

/** Each slot now live, against the person's other live slots — after the whole write, so order does not matter. */
async function refuseClashes(tx: ShiftScheduleTransaction, slots: readonly ShiftSlot[], now: Date): Promise<void> {
  for (const slot of slots) {
    if (slot.canceledAt === null && slot.endsAt.getTime() > now.getTime() && (await clashesFor(tx, slot))) {
      throw overlapError();
    }
  }
}

/** A rule a `following` cancel ended on this slot's day gets its end back. */
async function reopenRule(
  tx: ShiftScheduleTransaction,
  slot: ShiftSlot,
  actorUserId: string,
  builder: ChangeBuilder,
): Promise<void> {
  const rule = slot.seriesId === null ? null : await tx.getSeries(slot.clientId, slot.seriesId);
  if (!rule || rule.canceledFrom === null) return;
  if ((slot.seriesDate ?? zonedParts(slot.startsAt, rule.timeZone).date) !== rule.canceledFrom) return;
  builder.closedSeries(rule);
  await tx.updateSeries(rule.clientId, rule.id, {
    endsOn: rule.endsOnBeforeCancel,
    canceledFrom: null,
    endsOnBeforeCancel: null,
  });
  await tx.writeAudit({
    clientId: rule.clientId,
    actorUserId,
    action: 'shift.schedule.restore',
    resourceType: 'shift_slot_series',
    resourceId: rule.id,
    before: { endsOn: rule.endsOn },
    after: { endsOn: rule.endsOnBeforeCancel },
  });
}

export async function restoreSlot(ctx: ScheduleContext, input: RestoreSlotInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.actorUserId, 'actorUserId');
  if (input.slotIds.length === 0) throw invalid('slotIds must name at least one slot.');
  return ctx.db.transaction(async (tx) => {
    const found = await restorable(ctx, tx, input);
    await lockUsers(tx, input.clientId, found.map((slot) => slot.userId));
    const slots = await restorable(ctx, tx, input);
    const restored = await tx.restoreSlots(input.clientId, slots.map((slot) => slot.id));
    await refuseClashes(tx, restored, ctx.now());
    // "Created" as in made live by this write: its undo cancels them again.
    const builder = new ChangeBuilder().created(restored);
    for (const slot of slots) {
      await reopenRule(tx, slot, input.actorUserId, builder);
      await tx.writeAudit({
        clientId: input.clientId,
        actorUserId: input.actorUserId,
        action: 'shift.schedule.restore',
        resourceType: 'shift_slot',
        resourceId: slot.id,
        before: { seriesId: slot.seriesId, cancelReason: slot.cancelReason },
        after: { seriesId: slot.seriesId, cancelReason: null },
      });
    }
    return { slots: restored, series: null, change: await builder.seal(tx, input.clientId) };
  });
}

function patchOf(prior: ShiftSlotPrior): ShiftSlotPatch {
  return { ...prior, startsAt: new Date(prior.startsAt), endsAt: new Date(prior.endsAt) };
}

/** Every row and rule the change names, exactly as the write left it — or the undo is refused. */
async function unchangedSince(tx: ShiftScheduleTransaction, clientId: string, change: ScheduleChange): Promise<ShiftSlot[]> {
  const changed = (): ShiftScheduleError =>
    new ShiftScheduleError('SCHEDULE_CHANGED', 'The schedule changed since; this change can no longer be undone.');
  const slotIds = [...change.createdSlotIds, ...change.canceledSlotIds, ...change.editedSlots.map((entry) => entry.id)];
  const slots: ShiftSlot[] = [];
  for (const id of new Set(slotIds)) {
    const slot = await tx.getSlot(clientId, id);
    if (!slot || change.stamps.slots[id] !== slotStamp(slot)) throw changed();
    slots.push(slot);
  }
  for (const id of new Set([...change.createdSeriesIds, ...change.closedSeries.map((entry) => entry.id)])) {
    const series = await tx.getSeries(clientId, id);
    if (!series || change.stamps.series[id] !== seriesStamp(series)) throw changed();
  }
  return slots;
}

async function cancelForUndo(tx: ShiftScheduleTransaction, clientId: string, ids: readonly string[], actorUserId: string, now: Date): Promise<ShiftSlot[]> {
  return tx.cancelSlots({ clientId, slotIds: ids, canceledAt: now, canceledByUserId: actorUserId, cancelReason: 'undo' });
}

/**
 * Retire each rule the write created: closed, and every live row of it
 * canceled — later-built ones too. A row handed to another person is theirs
 * now and is never touched; the day it holds is left to it by the rule the
 * undo puts back, which would otherwise build that day a second time.
 */
async function retireCreatedSeries(
  tx: ShiftScheduleTransaction,
  input: RevertScheduleChangeInput,
  now: Date,
  builder: ChangeBuilder,
): Promise<void> {
  for (const id of input.change.createdSeriesIds) {
    const rule = await tx.getSeries(input.clientId, id);
    if (!rule) continue;
    const rows = (await tx.listSeriesRows(input.clientId, id, EARLIEST, LATEST)).filter((row) => row.canceledAt === null);
    const own = rows.filter((row) => row.seriesId === id && row.userId === rule.userId);
    const handed = rows.filter((row) => !own.includes(row));
    builder.canceled(await cancelForUndo(tx, input.clientId, own.map((row) => row.id), input.actorUserId, now));
    await leaveHandedDays(tx, rule, handed);
    builder.closedSeries(rule);
    const endsOn = addLocalDays(rule.startsOn, -1);
    await tx.updateSeries(input.clientId, id, { endsOn });
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.series',
      resourceType: 'shift_slot_series',
      resourceId: id,
      before: { endsOn: rule.endsOn },
      after: { endsOn, canceled: String(own.length), kept: handed.length > 0 ? handed.map((row) => row.id).join(',') : null, reason: 'undo' },
    });
  }
}

/** The days rows handed out of a retired rule hold, recorded as skipped on the rule it replaced. */
async function leaveHandedDays(tx: ShiftScheduleTransaction, rule: ShiftSlotSeries, handed: readonly ShiftSlot[]): Promise<void> {
  if (handed.length === 0 || rule.previousSeriesId === null) return;
  const previous = await tx.getSeries(rule.clientId, rule.previousSeriesId);
  if (!previous) return;
  const days = handed.map((row) => row.seriesDate ?? zonedParts(row.startsAt, rule.timeZone).date);
  await tx.updateSeries(previous.clientId, previous.id, {
    skippedDates: [...new Set([...previous.skippedDates, ...days])].sort(),
  });
}

async function putBackSeriesEnds(tx: ShiftScheduleTransaction, input: RevertScheduleChangeInput, builder: ChangeBuilder): Promise<void> {
  for (const { id, priorEndsOn, priorCanceledFrom, priorEndsOnBeforeCancel } of input.change.closedSeries) {
    const rule = await tx.getSeries(input.clientId, id);
    if (!rule) continue;
    builder.closedSeries(rule);
    // The memory of a `following` cancel goes back too: an undone restore leaves the rule restorable again.
    await tx.updateSeries(input.clientId, id, {
      endsOn: priorEndsOn,
      canceledFrom: priorCanceledFrom,
      endsOnBeforeCancel: priorEndsOnBeforeCancel,
    });
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action: 'shift.schedule.series',
      resourceType: 'shift_slot_series',
      resourceId: id,
      before: { endsOn: rule.endsOn, canceledFrom: rule.canceledFrom },
      after: { endsOn: priorEndsOn, canceledFrom: priorCanceledFrom, reason: 'undo' },
    });
  }
}

async function auditSlots(tx: ShiftScheduleTransaction, input: RevertScheduleChangeInput, slots: readonly ShiftSlot[], action: 'shift.schedule.edit' | 'shift.schedule.restore'): Promise<void> {
  for (const slot of slots) {
    await tx.writeAudit({
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'shift_slot',
      resourceId: slot.id,
      before: { seriesId: slot.seriesId },
      after: { seriesId: slot.seriesId, reason: 'undo' },
    });
  }
}

export async function revertScheduleChange(ctx: ScheduleContext, input: RevertScheduleChangeInput): Promise<ScheduleWriteResult> {
  requireText(input.clientId, 'clientId');
  requireText(input.actorUserId, 'actorUserId');
  const { change } = input;
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const touched = await unchangedSince(tx, input.clientId, change);
    const priors = change.editedSlots.map((entry) => entry.prior.userId);
    await lockUsers(tx, input.clientId, [...touched.map((slot) => slot.userId), ...priors]);
    await unchangedSince(tx, input.clientId, change);
    const builder = new ChangeBuilder();
    await retireCreatedSeries(tx, input, now, builder);
    builder.canceled(await cancelForUndo(tx, input.clientId, change.createdSlotIds, input.actorUserId, now));
    const edited: ShiftSlot[] = [];
    for (const { id, prior } of change.editedSlots) {
      const before = await tx.getSlot(input.clientId, id);
      if (before) builder.edited(before);
      edited.push(await tx.updateSlot(input.clientId, id, patchOf(prior)));
    }
    await putBackSeriesEnds(tx, input, builder);
    const restored = await tx.restoreSlots(input.clientId, change.canceledSlotIds);
    builder.created(restored);
    await refuseClashes(tx, [...edited, ...restored], now);
    await auditSlots(tx, input, edited, 'shift.schedule.edit');
    await auditSlots(tx, input, restored, 'shift.schedule.restore');
    return { slots: [...restored, ...edited], series: null, change: await builder.seal(tx, input.clientId) };
  });
}
