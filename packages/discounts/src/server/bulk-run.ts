import type {
  DiscountBulkCode,
  DiscountBulkCounts,
  DiscountBulkOperation,
  DiscountBulkResult,
  DiscountBulkRow,
  DiscountBulkState,
  DiscountBulkUndoRow,
} from "../bulk";
import { addCalendarDays, calendarDayAt, wholeDayWindow } from "../timezone";
import type { ReadZone } from "./calendar-days";
import type { DiscountsBulkServerCopy } from "./copy";
import { errorText, type DiscountsLogger } from "./logging";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "./store";
import { shownDays } from "./update-window";
import type { DiscountScalars } from "./validate";

/**
 * The bulk actions' engine (FUT-4420): one row at a time, each decided from a
 * fresh read and written under a condition, so a batch of up to 500 can never
 * overwrite what somebody else changed between the read and the write.
 *
 * ## The shape of a row
 *
 * A row is PLANNED from the record read now - `unchanged`, `skipped` with the
 * reason, or a `change` to the flag and the window - and a `change` is then
 * COMMITTED under {@link conditionOf}. A store that answers `{ applied: false }`
 * sends the row back to be read and planned again: the second plan may find
 * the row already holds the value (`unchanged`), or still differs and writes.
 * A row that keeps moving three times is `failed`, retryable, never forced.
 *
 * ## What a row never does
 *
 * It never counts a row that already held the value as changed: Desfazer is
 * offered for the `ok` rows only, so an "Ativar todos" on a mixed selection
 * cannot deactivate the discounts that were active before it.
 */

/** How many reads one row may make before it is `failed` as moving. */
const ATTEMPTS = 3;

/** A planned outcome that writes nothing. */
interface Settled {
  kind: "settled";
  status: "unchanged" | "skipped";
  code: DiscountBulkCode;
}

/** A planned change: the state the row should hold. */
interface Change {
  kind: "change";
  next: DiscountBulkState;
  code: DiscountBulkCode;
  endsOn?: string | null;
  revived?: boolean;
}

type Plan = Settled | Change;

/** Everything one batch shares: the clock, the zone, the words and the store. */
export interface BulkContext {
  store: DiscountStore;
  clientId: string;
  zone: ReadZone;
  now: Date;
  words: DiscountsBulkServerCopy;
  logger: DiscountsLogger;
}

const settled = (status: Settled["status"], code: DiscountBulkCode): Settled => ({ kind: "settled", status, code });

/** The state Desfazer restores, from a record read now. */
function stateOf(record: DiscountRecord): DiscountBulkState {
  return {
    active: record.active,
    startsAt: record.startsAt === null ? null : record.startsAt.toISOString(),
    endsAt: record.endsAt === null ? null : record.endsAt.toISOString(),
    windowInZone: record.windowInZone === true,
  };
}

/** Whether two states are the same flag and the same instants. */
function sameState(a: DiscountBulkState, b: DiscountBulkState): boolean {
  const instant = (value: string | null): number | null => (value === null ? null : new Date(value).getTime());
  return (
    a.active === b.active &&
    a.windowInZone === b.windowInZone &&
    instant(a.startsAt) === instant(b.startsAt) &&
    instant(a.endsAt) === instant(b.endsAt)
  );
}

function planSetActive(record: DiscountRecord, active: boolean): Plan {
  if (record.active === active) return settled("unchanged", active ? "alreadyActive" : "alreadyInactive");
  return { kind: "change", next: { ...stateOf(record), active }, code: active ? "activated" : "deactivated" };
}

/** The new last day an extension asks for, per row. */
type Extension = { days: number } | { endsOn: string };

/** The store's "today" in the calendar the window is counted on. */
function todayOf(zone: ReadZone, now: Date): string | null {
  if (zone.kind === "zone") return calendarDayAt(now, zone.timeZone);
  return zone.kind === "off" ? now.toISOString().slice(0, 10) : null;
}

/** The window an extension writes: whole days on the store's clock, legacy midnights with none. */
function windowFor(
  record: DiscountRecord,
  days: { startsOn: string | null },
  newEndsOn: string,
  zone: ReadZone,
): { startsAt: Date | null; endsAt: Date | null; windowInZone: boolean } | null {
  if (zone.kind === "zone") {
    // A zoned row keeps its own start (it is already a whole-day instant); a legacy row
    // is converted whole, as the edit form does when its dates change.
    if (record.windowInZone === true) {
      return { startsAt: record.startsAt, endsAt: wholeDayWindow(null, newEndsOn, zone.timeZone).endsAt, windowInZone: true };
    }
    return { ...wholeDayWindow(days.startsOn, newEndsOn, zone.timeZone), windowInZone: true };
  }
  // Zone off: only a legacy row has a window to move, on UTC midnights.
  if (zone.kind === "off" && record.windowInZone !== true) {
    return { startsAt: record.startsAt, endsAt: new Date(`${newEndsOn}T00:00:00.000Z`), windowInZone: false };
  }
  return null;
}

/** The last day an extension asks for, from the row's own end (or today, once it ended). */
function newEndOf(extension: Extension, shownEnd: string, ended: boolean, today: string): string {
  if ("endsOn" in extension) return extension.endsOn;
  return addCalendarDays(ended ? today : shownEnd, extension.days);
}

/** Why a new end cannot be written for a row, or null when it can. */
function refusalOf(newEnd: Date, record: DiscountRecord, ended: boolean, now: Date): Settled | null {
  if (newEnd.getTime() === record.endsAt?.getTime()) return settled("unchanged", "alreadyEndsThen");
  if (newEnd.getTime() < (record.endsAt?.getTime() ?? 0)) return settled("skipped", "notLater");
  if (ended && newEnd.getTime() <= now.getTime()) return settled("skipped", "stillEnded");
  return null;
}

/**
 * The state after an extension: the new window and the SAME flag. A discount
 * paused by hand stays paused even when it had ended (decided on FUT-4420, N6);
 * only an ended one that was active "voltou a valer".
 */
function extendedState(
  record: DiscountRecord,
  window: { startsAt: Date | null; endsAt: Date | null; windowInZone: boolean },
): DiscountBulkState {
  return {
    active: record.active,
    startsAt: window.startsAt?.toISOString() ?? null,
    endsAt: window.endsAt?.toISOString() ?? null,
    windowInZone: window.windowInZone,
  };
}

/** "Nova data" compares DAYS with the day the row shows, as the single-row edit does (review B3). */
function dayRefusal(extension: Extension, shownEnd: string, newEnd: string): Settled | null {
  if (!("endsOn" in extension)) return null;
  if (newEnd === shownEnd) return settled("unchanged", "alreadyEndsThen");
  return newEnd < shownEnd ? settled("skipped", "notLater") : null;
}

function planExtend(record: DiscountRecord, extension: Extension, ctx: BulkContext): Plan {
  if (record.endsAt === null) return settled("skipped", "noEndDate");
  const shown = shownDays(record, ctx.zone);
  const today = todayOf(ctx.zone, ctx.now);
  if (shown === null || shown.endsOn === null || today === null) return settled("skipped", "zoneUnknown");
  const ended = record.endsAt.getTime() <= ctx.now.getTime();
  const newEndsOn = newEndOf(extension, shown.endsOn, ended, today);
  const sameDay = dayRefusal(extension, shown.endsOn, newEndsOn);
  if (sameDay !== null) return sameDay;
  const window = windowFor(record, shown, newEndsOn, ctx.zone);
  if (window === null || window.endsAt === null) return settled("skipped", "zoneOff");
  const refused = refusalOf(window.endsAt, record, ended, ctx.now);
  if (refused !== null) return refused;
  return extensionChange(record, window, newEndsOn, ended);
}

/** The change an extension makes, and what the row says about it. */
function extensionChange(
  record: DiscountRecord,
  window: { startsAt: Date | null; endsAt: Date | null; windowInZone: boolean },
  newEndsOn: string,
  ended: boolean,
): Change {
  const revived = ended && record.active;
  const code: DiscountBulkCode = revived ? "revived" : ended ? "extendedPaused" : "extended";
  return { kind: "change", next: extendedState(record, window), code, endsOn: newEndsOn, revived };
}

function planUndo(record: DiscountRecord, row: DiscountBulkUndoRow): Plan {
  const current = stateOf(record);
  if (sameState(current, row.before)) return settled("unchanged", "alreadyRestored");
  if (!sameState(current, row.after)) return settled("skipped", "changedSince");
  return { kind: "change", next: row.before, code: "restored" };
}

/** The record re-stated whole, with the planned flag and window over it. */
function writeOf(record: DiscountRecord, next: DiscountBulkState): DiscountWrite {
  const scalars: DiscountScalars = {
    name: record.name,
    type: record.type as DiscountScalars["type"],
    percentOffBp: record.percentOffBp,
    amountOffCents: record.amountOffCents,
    bundlePriceCents: record.bundlePriceCents ?? null,
    freeUnits: record.freeUnits ?? null,
    maxComboApplications: record.maxComboApplications ?? null,
    scope: record.scope as DiscountScalars["scope"],
    trigger: record.trigger as DiscountScalars["trigger"],
    code: record.code,
    startsAt: next.startsAt === null ? null : new Date(next.startsAt),
    endsAt: next.endsAt === null ? null : new Date(next.endsAt),
    windowInZone: next.windowInZone,
    schedule: record.schedule ?? null,
    minSubtotalCents: record.minSubtotalCents,
    usageLimit: record.usageLimit,
    perBuyerLimit: record.perBuyerLimit,
    firstOrderOnly: record.firstOrderOnly === true,
    stackable: record.stackable,
    active: next.active,
  };
  return {
    scalars,
    targets: {
      categoryIds: [...record.categoryIds],
      menuItemIds: [...record.menuItemIds],
      comboRequirements: record.comboRequirements ? [...record.comboRequirements] : [],
    },
  };
}

/** The condition a write is made under: the window AND the flag as read. */
function conditionOf(record: DiscountRecord): DiscountUpdateCondition {
  return {
    window: { startsAt: record.startsAt, endsAt: record.endsAt, windowInZone: record.windowInZone === true },
    active: record.active,
  };
}

/** What deciding one row needs, whichever operation it belongs to. */
type Planner = (record: DiscountRecord) => Plan;

type Committed = { applied: true } | { applied: false };

async function commit(
  ctx: BulkContext,
  record: DiscountRecord,
  change: Change,
  validateOnly: boolean,
): Promise<Committed> {
  if (validateOnly) return { applied: true };
  const outcome = await ctx.store.update(ctx.clientId, record.id, writeOf(record, change.next), conditionOf(record));
  if (outcome === undefined) {
    ctx.logger.warn(
      `discounts: the store's update answered nothing for the bulk condition on rule ${record.id} - return ` +
        "{ applied } from DiscountStore.update; until then a concurrent write between the read and this one " +
        "can be overwritten.",
    );
    return { applied: true };
  }
  return { applied: outcome.applied };
}

const rowOf = (
  words: DiscountsBulkServerCopy,
  id: string,
  name: string | null,
  status: DiscountBulkRow["status"],
  code: DiscountBulkCode,
  extra: Partial<DiscountBulkRow> = {},
): DiscountBulkRow => ({
  id,
  name,
  status,
  code,
  message: words[code],
  retryable: status === "failed",
  ...extra,
});

/** One row, planned and committed, read again where the row moved underneath. */
async function runRow(
  ctx: BulkContext,
  id: string,
  plan: Planner,
  validateOnly: boolean,
  seen: { name: string | null },
): Promise<DiscountBulkRow> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const record = await ctx.store.get(ctx.clientId, id);
    if (record === null) return rowOf(ctx.words, id, seen.name, "skipped", "notFound");
    // A failed row must still name its discount: it is the one a person has to find.
    seen.name = record.name;
    const decided = plan(record);
    if (decided.kind === "settled") return rowOf(ctx.words, id, record.name, decided.status, decided.code);
    const committed = await commit(ctx, record, decided, validateOnly);
    if (!committed.applied) continue;
    return rowOf(ctx.words, id, record.name, "ok", decided.code, {
      before: stateOf(record),
      after: decided.next,
      ...(decided.endsOn === undefined ? {} : { endsOn: decided.endsOn }),
      ...(decided.revived === true ? { revived: true } : {}),
    });
  }
  return rowOf(ctx.words, id, seen.name, "failed", "changedDuringBatch");
}

/** A row that threw: reported and logged, and the batch goes on. */
async function guarded(
  ctx: BulkContext,
  id: string,
  seen: { name: string | null },
  run: () => Promise<DiscountBulkRow>,
): Promise<DiscountBulkRow> {
  try {
    return await run();
  } catch (error) {
    ctx.logger.error(`discounts: bulk row ${id} for tenant ${ctx.clientId} failed: ${errorText(error)}`);
    return rowOf(ctx.words, id, seen.name, "failed", "failed");
  }
}

function countsOf(rows: readonly DiscountBulkRow[]): DiscountBulkCounts {
  const counts: DiscountBulkCounts = { ok: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** The ids of an operation, de-duplicated, in the order asked. */
function bulkIdsOf(body: DiscountBulkOperation): string[] {
  const asked = body.operation === "undo" ? body.rows.map((row) => row.id) : body.ids;
  return [...new Set(asked)];
}

/** Runs a validated bulk body, one row at a time, and answers every row. */
export async function runBulk(ctx: BulkContext, body: DiscountBulkOperation): Promise<DiscountBulkResult> {
  const validateOnly = body.validateOnly === true;
  const undoRows = body.operation === "undo" ? new Map(body.rows.map((row) => [row.id, row])) : null;
  const rows: DiscountBulkRow[] = [];
  for (const id of bulkIdsOf(body)) {
    const plan = plannerFor(ctx, body, undoRows?.get(id));
    const seen = { name: null as string | null };
    rows.push(await guarded(ctx, id, seen, () => runRow(ctx, id, plan, validateOnly, seen)));
  }
  return { operation: body.operation, validateOnly, counts: countsOf(rows), rows };
}

function plannerFor(ctx: BulkContext, body: DiscountBulkOperation, undo: DiscountBulkUndoRow | undefined): Planner {
  if (body.operation === "setActive") return (record) => planSetActive(record, body.active);
  if (body.operation === "undo" && undo !== undefined) return (record) => planUndo(record, undo);
  const extension: Extension =
    body.operation === "extendWindow" && body.endsOn !== undefined
      ? { endsOn: body.endsOn }
      : { days: body.operation === "extendWindow" ? (body.days ?? 0) : 0 };
  return (record) => planExtend(record, extension, ctx);
}
