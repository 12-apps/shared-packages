import type { DiscountsLogger } from "./logging";
import type { DiscountRecord, DiscountStore, DiscountUpdateCondition, DiscountWrite } from "./store";
import type { DiscountWriteBody } from "./validate";

/**
 * What a PATCH writes for the window, when it depends on the row (FUT-4482,
 * review round 5). The principle: an edit is never refused over a date
 * problem. A screen may warn above the editor; the server stores the edit.
 *
 * Two writes read the row first:
 *
 * - `keepWindow` — the form could not show the days (the store's zone is not
 *   one the runtime knows) and sent none. Every other field is written over
 *   the STORED bounds and flag, with no zone asked.
 * - the zone OFF (the release before whole days, or a rollback to it). A row
 *   written in the zone cannot be placed on this release's clock, so:
 *   - the dates the zone-off form showed (each stored bound's UTC date) came
 *     back unchanged: the stored bounds and `windowInZone: true` are written,
 *     so a pause, a rename or a new value leaves the row flagged;
 *   - they changed: they are stored as legacy UTC midnights with the flag
 *     false, as a create under this release stores them, and the id is logged
 *     so the host's migration, rerun, converts the row.
 *
 * Both are conditional on the row still holding the window and flag that were
 * read (see {@link DiscountUpdateCondition}); a store answering
 * `{ applied: false }` sends the route back to read and decide again.
 */

type StoredWindow = Pick<DiscountRecord, "startsAt" | "endsAt" | "windowInZone">;

/** How many reads one PATCH may make before a row that keeps moving is an error. */
const ATTEMPTS = 3;

/** The two dates the body sent, `""` folded to null as the validator folds it. */
export interface SentDays {
  startsAt: string | null;
  endsAt: string | null;
}

const blankToNull = (day: string | null): string | null => (day === "" ? null : day);

/** A stored bound as the zone-off form shows it: its UTC date. */
const utcDay = (bound: Date | string | null): string | null =>
  bound === null ? null : new Date(bound).toISOString().slice(0, 10);

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

export type WindowMode = { kind: "keep" } | { kind: "zone-off"; sent: SentDays };

/** The form's word that it could not show the days and sends none. */
export function keepsWindow(body: unknown): boolean {
  return (body as DiscountWriteBody | null)?.keepWindow === true;
}

/** Whether a PATCH's window depends on the stored row, and how; null when it does not. */
export function windowModeOf(prepared: {
  keepWindow: boolean;
  timeZone: string | undefined;
  sent: SentDays;
}): WindowMode | null {
  if (prepared.keepWindow) return { kind: "keep" };
  // With the zone on there is nothing to un-flag: every write is in the zone.
  return prepared.timeZone === undefined ? { kind: "zone-off", sent: prepared.sent } : null;
}

/** One decision over one read: what to write, under what condition. */
function decide(
  mode: WindowMode,
  row: DiscountRecord,
  write: DiscountWrite,
  context: { id: string; logger: DiscountsLogger },
): DiscountWrite {
  if (mode.kind === "keep") return keepingStored(write, row);
  if (typeof row.windowInZone !== "boolean") {
    context.logger.warn(
      "discounts: the store answered a record without windowInZone while storeTimeZone is off — map the " +
        "column into DiscountRecord; until then a rule written in the store's zone cannot be told from a " +
        "legacy one, and a save re-states it on UTC midnights.",
    );
  }
  if (row.windowInZone !== true) return write;
  const unchanged =
    blankToNull(mode.sent.startsAt) === utcDay(row.startsAt) && blankToNull(mode.sent.endsAt) === utcDay(row.endsAt);
  if (unchanged) return keepingStored(write, row);
  context.logger.warn(
    `discounts: rule ${context.id} was written in the store's zone and saved with new dates while ` +
      "storeTimeZone is off — stored as legacy (window_in_zone false); rerun the migration once the zone " +
      "is back to convert it.",
  );
  return write;
}

/**
 * Read, decide, write under the read's condition — again on a row that moved.
 * `missing` when the row is gone: for `keep` that is the caller's not-found (there
 * is no stored window to keep); with the zone off the plain write goes to the
 * store, whose not-found it always was.
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
      if (mode.kind === "keep") return "missing";
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
  throw new Error(
    `@12-apps/discounts: rule ${id} changed under ${ATTEMPTS} writes in a row — each read of its window ` +
      "was stale by the time the conditional update ran.",
  );
}
