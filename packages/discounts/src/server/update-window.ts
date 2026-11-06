import { legacyWindowDays, windowCalendarDays } from "../timezone";
import type { ReadZone } from "./calendar-days";
import type { DiscountsLogger } from "./logging";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "./store";
import type { DiscountValidationError, DiscountWriteBody } from "./validate";

/**
 * What a PATCH writes for the window, decided from the row it reads first
 * (FUT-4482, review rounds 5 and 6). The principle: an edit is never refused,
 * and **a save that does not change the dates never moves them.**
 *
 * - `keepWindow` — the form could not show the days (the store's zone is not
 *   one the runtime knows) and sent none. Every other field is written over the
 *   STORED bounds and flag, with no zone asked.
 * - Otherwise the sent days are compared with the days a READ of that row
 *   shows: a flag-false row's `legacyWindowDays` (and every row's, with the
 *   zone off, whose form shows each bound's UTC date); a flag-true row's days
 *   in the store's zone. **Equal**, the stored `startsAt` / `endsAt` /
 *   `windowInZone` are written unchanged — with the zone on, off or unknown —
 *   so a pause of a legacy row neither grows a day nor turns zoned, and a pause
 *   while the zone is unknown is not refused. **Changed**, the existing paths:
 *   whole days in a known zone, legacy UTC midnights with the zone off (a
 *   flag-true row's id is logged so the migration, rerun, converts it), and
 *   the date-field 422 when the zone is unknown.
 *
 * Every write is conditional on the row still holding the window and flag that
 * were read (see {@link DiscountUpdateCondition}); a store answering
 * `{ applied: false }` sends the route back to read and decide again, and a row
 * that keeps moving is a {@link WindowChangedError} — a 409, never a 500.
 */

type StoredWindow = Pick<DiscountRecord, "startsAt" | "endsAt" | "windowInZone">;

/** How many reads one PATCH may make before a row that keeps moving is a conflict. */
const ATTEMPTS = 3;

/** The two dates the body sent, `""` folded to null as the validator folds it. */
export interface SentDays {
  startsAt: string | null;
  endsAt: string | null;
}

/** The row's window kept changing under every conditional write: answered 409. */
export class WindowChangedError extends Error {
  readonly status = 409;

  constructor(id: string) {
    super(
      `@12-apps/discounts: rule ${id} changed under ${ATTEMPTS} writes in a row — each read of its window ` +
        "was stale by the time the conditional update ran.",
    );
    this.name = "WindowChangedError";
  }
}

const blankToNull = (day: string | null): string | null => (day === "" ? null : day);

function conditionOf(row: StoredWindow): DiscountUpdateCondition {
  return { window: { startsAt: row.startsAt, endsAt: row.endsAt, windowInZone: row.windowInZone === true } };
}

/** The validated write with the stored window put back over its own. */
function keepingStored(write: DiscountWrite, row: StoredWindow): DiscountWrite {
  return {
    ...write,
    scalars: { ...write.scalars, startsAt: row.startsAt, endsAt: row.endsAt, windowInZone: row.windowInZone === true },
  };
}

export type WindowMode =
  | { kind: "keep" }
  | {
      kind: "days";
      sent: SentDays;
      /** Where a read of this row placed its days. */
      zone: ReadZone;
      /** The date-field 422 held until the read: said only when the days changed. */
      refusal: DiscountValidationError | null;
    };

/** The form's word that it could not show the days and sends none. */
export function keepsWindow(body: unknown): boolean {
  return (body as DiscountWriteBody | null)?.keepWindow === true;
}

/** Whether a body that keeps the window also sends a date — a contradiction. */
export function sendsDates(sent: SentDays): boolean {
  return blankToNull(sent.startsAt) !== null || blankToNull(sent.endsAt) !== null;
}

/** How a PATCH's window is decided: every PATCH reads the row now (review round 6). */
export function windowModeOf(prepared: {
  keepWindow: boolean;
  zone: ReadZone;
  sent: SentDays;
  refusal: DiscountValidationError | null;
}): WindowMode {
  if (prepared.keepWindow) return { kind: "keep" };
  return { kind: "days", sent: prepared.sent, zone: prepared.zone, refusal: prepared.refusal };
}

/** The days a read of `row` showed, or null where it showed none (`daysUnknown`). */
function shownDays(row: StoredWindow, zone: ReadZone): { startsOn: string | null; endsOn: string | null } | null {
  if (zone.kind === "off" || row.windowInZone !== true) return legacyWindowDays(row.startsAt, row.endsAt);
  if (zone.kind === "unknown") return null;
  return windowCalendarDays(row.startsAt, row.endsAt, zone.timeZone);
}

function unchanged(row: StoredWindow, mode: Extract<WindowMode, { kind: "days" }>): boolean {
  const shown = shownDays(row, mode.zone);
  return (
    shown !== null &&
    blankToNull(mode.sent.startsAt) === shown.startsOn &&
    blankToNull(mode.sent.endsAt) === shown.endsOn
  );
}

/** A changed window with the zone off: legacy, and said when the row was zoned. */
function zoneOffChange(row: DiscountRecord, write: DiscountWrite, context: { id: string; logger: DiscountsLogger }) {
  if (typeof row.windowInZone !== "boolean") {
    context.logger.warn(
      "discounts: the store answered a record without windowInZone while storeTimeZone is off — map the " +
        "column into DiscountRecord; until then a rule written in the store's zone cannot be told from a " +
        "legacy one, and a save re-states it on UTC midnights.",
    );
  }
  if (row.windowInZone === true) {
    context.logger.warn(
      `discounts: rule ${context.id} was written in the store's zone and saved with new dates while ` +
        "storeTimeZone is off — stored as legacy (window_in_zone false); rerun the migration once the zone " +
        "is back to convert it.",
    );
  }
  return write;
}

/** One decision over one read: what to write, under what condition. */
function decide(
  mode: WindowMode,
  row: DiscountRecord,
  write: DiscountWrite,
  context: { id: string; logger: DiscountsLogger },
): DiscountWrite {
  if (mode.kind === "keep" || unchanged(row, mode)) return keepingStored(write, row);
  if (mode.refusal !== null) throw mode.refusal;
  return mode.zone.kind === "off" ? zoneOffChange(row, write, context) : write;
}

/**
 * Read, decide, write under the read's condition — again on a row that moved.
 * `missing` when the row is gone and nothing could be written without it: for
 * `keep` (there is no stored window to keep) and for days held on a refusal.
 * Otherwise the plain write goes to the store, whose not-found it always was.
 */
export async function updateWithWindow(
  store: DiscountStore,
  target: { clientId: string; id: string; logger: DiscountsLogger },
  mode: WindowMode,
  write: DiscountWrite,
): Promise<"written" | "missing"> {
  const { clientId, id, logger } = target;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const row = await store.get(clientId, id);
    if (row === null) {
      if (mode.kind === "keep" || mode.refusal !== null) return "missing";
      await store.update(clientId, id, write);
      return "written";
    }
    const condition = conditionOf(row);
    const outcome = await store.update(clientId, id, decide(mode, row, write, { id, logger }), condition);
    if (outcome === undefined) {
      logger.warn(
        `discounts: the store's update answered nothing for the window condition on rule ${id} — return ` +
          "{ applied } from DiscountStore.update; until then a concurrent write between the read and this one " +
          "can be overwritten.",
      );
      return "written";
    }
    if (outcome.applied) return "written";
  }
  throw new WindowChangedError(id);
}
