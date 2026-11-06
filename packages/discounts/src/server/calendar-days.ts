import { isKnownTimeZone, legacyWindowDays, windowCalendarDays } from "../timezone";
import type { DiscountsServerCopy } from "./copy";
import type { DiscountsLogger } from "./logging";
import type { DiscountPage, DiscountRecord } from "./store";

/**
 * The store's zone, per tenant, as a host answers it (FUT-4482).
 *
 * A FUNCTION of the tenant, not a value: one host serves stores in different
 * zones, and only it knows which column holds a store's clock. Optional — see
 * `DiscountWindowOptions` for what a host that passes nothing keeps.
 */
export type StoreTimeZone = (clientId: string) => string | Promise<string>;

/**
 * The tenant's zone, or undefined when the host counts no whole days.
 *
 * A host that DOES count them and answers no zone for a tenant — an unguarded
 * `findUnique` that came back null — gets an exception, never undefined: that
 * would quietly store this tenant's windows on UTC midnights, the meaning the
 * host turned off, with nothing red anywhere.
 */
export async function zoneFor(
  storeTimeZone: StoreTimeZone | undefined,
  clientId: string,
): Promise<string | undefined> {
  if (storeTimeZone === undefined) return undefined;
  const zone: unknown = await storeTimeZone(clientId);
  if (typeof zone === "string" && zone.trim() !== "") return zone;
  throw new Error(
    `@12-apps/discounts: storeTimeZone answered ${zone === "" ? "an empty string" : String(zone)} for tenant ` +
      `"${clientId}" — it must answer the store's IANA zone for every tenant it is asked about.`,
  );
}

/**
 * Where a READ places days (FUT-4482): nowhere (`off`, the host counts no
 * whole days), on a zone this runtime knows, or on a zone it does not
 * (`unknown`) — which only a row written in a zone needs; a legacy row reads
 * on UTC without one.
 */
export type ReadZone = { kind: "off" } | { kind: "zone"; timeZone: string } | { kind: "unknown" };

const OFF: ReadZone = { kind: "off" };

/**
 * The zone a read places days on. A zone the runtime does not know cannot place
 * them, and a read is not where that must stop the screen: nothing is stored
 * from it, and a write that sends dates refuses that zone on the date field. So a row written in
 * the zone is answered `daysUnknown` — days placed on UTC would be other days
 * than the store's, and a form would show them as if they were — and the
 * logger says why.
 */
export async function readZoneFor(
  storeTimeZone: StoreTimeZone | undefined,
  clientId: string,
  logger: DiscountsLogger,
): Promise<ReadZone> {
  const zone = await zoneFor(storeTimeZone, clientId);
  if (zone === undefined) return OFF;
  if (isKnownTimeZone(zone)) return { kind: "zone", timeZone: zone };
  logger.warn(
    `discounts: unknown store time zone "${zone}" for tenant ${clientId} — rules written in it are ` +
      "answered without their days, and dates sent to it are refused until the zone is one this runtime knows.",
  );
  return { kind: "unknown" };
}

/**
 * The zone a write just stored in, as a read of its answer sees it — the same
 * three kinds a read answers (review round 9, B1). A write under an unknown
 * zone stores only what needs no clock (no dates), and its answer must not then
 * try to place days on that zone: the throw was a 500 for a row that WAS
 * stored, and a retry stored a second promotion.
 */
export function writtenZone(timeZone: string | undefined): ReadZone {
  if (timeZone === undefined) return OFF;
  return isKnownTimeZone(timeZone) ? { kind: "zone", timeZone } : { kind: "unknown" };
}

type Windowed = Pick<DiscountRecord, "startsAt" | "endsAt" | "windowInZone">;

/** What a read adds to a record: its days, or the word that they cannot be placed. */
type WithDays = Pick<DiscountRecord, "startsOn" | "endsOn" | "daysUnknown" | "datesLocked">;

/**
 * One record with the days it runs on — what a form reads back instead of
 * re-deriving days from instants it cannot place on a clock. The row's own
 * flag decides the clock: `windowInZone` true reads in the store's zone (or
 * `daysUnknown` when that zone cannot be placed); false, or a store that never
 * mapped the column, reads the legacy UTC days the old form showed — so the
 * previous release's writes during a rollout stay right. Without whole days
 * the record is answered exactly as the store built it.
 *
 * With the zone unknown EVERY row is `datesLocked` (review round 8): no new
 * day can be placed without the zone — a whole-day Término is inclusive, and
 * a legacy UTC midnight would drop it — so the form shows the days it can and
 * edits none. A legacy row still shows its UTC days; a zoned row has none to
 * show, and is `daysUnknown` too — unless it has no bounds at all (round 9):
 * an open window is open on any clock, so it reads "sem prazo", not unknown.
 */
export function withCalendarDays<R extends Windowed>(record: R, zone: ReadZone): R & WithDays {
  if (zone.kind === "off") return record;
  const locked = zone.kind === "unknown" ? { datesLocked: true } : {};
  if (record.windowInZone !== true) return { ...record, ...legacyWindowDays(record.startsAt, record.endsAt), ...locked };
  if (zone.kind === "unknown") {
    const open = record.startsAt === null && record.endsAt === null;
    return open ? { ...record, startsOn: null, endsOn: null, ...locked } : { ...record, daysUnknown: true, ...locked };
  }
  return { ...record, ...windowCalendarDays(record.startsAt, record.endsAt, zone.timeZone) };
}

/**
 * Every row of a page, the same way. Under an unknown zone the PAGE says so
 * too (`datesLocked`, CP8): a create has no row to read the lock off, and the
 * list may be empty — a store's first promotion — so the create form learns
 * from the envelope that a dated create would be refused, and offers none.
 */
export function pageWithCalendarDays(page: DiscountPage, zone: ReadZone): DiscountPage & { datesLocked?: true } {
  if (zone.kind === "off") return page;
  const data = page.data.map((row) => withCalendarDays(row, zone));
  return zone.kind === "unknown" ? { ...page, data, datesLocked: true } : { ...page, data };
}

/**
 * A store that answers no `windowInZone` on a surface counting whole days
 * maps a row without the column: every rule would read as legacy, a day early
 * west of UTC once written in the zone. Said, never guessed.
 */
export function warnUnflagged(
  records: readonly Windowed[],
  zone: ReadZone,
  logger: DiscountsLogger,
): void {
  if (zone.kind === "off" || records.every((row) => typeof row.windowInZone === "boolean")) return;
  logger.warn(
    "discounts: the store answered a record without windowInZone while storeTimeZone is on — map the " +
      "column into DiscountRecord; until then every rule reads on the legacy UTC days.",
  );
}

/** The sentences only a surface counting whole days says (FUT-4482). */
const WHOLE_DAY_KEYS = ["endsBeforeStartDay", "datesNeedKnownZone"] as const;

const said = (sentence: string | undefined): sentence is string =>
  typeof sentence === "string" && sentence.trim() !== "";

/**
 * A host that counts whole days says the refusal that goes with them, which
 * the plain pack key cannot: equal days are legal there, so "must be after"
 * would be false. Asserted at the mount, where the wiring is written, on the
 * DEFAULT rendering — the one every other key is asserted on.
 */
export function assertWholeDayCopy(
  storeTimeZone: StoreTimeZone | undefined,
  copy: DiscountsServerCopy,
): void {
  if (storeTimeZone === undefined) return;
  const missing = WHOLE_DAY_KEYS.filter((key) => !said(copy[key]));
  if (missing.length === 0) return;
  throw new Error(
    "@12-apps/discounts: createApiDiscounts counts whole days (storeTimeZone) but is missing copy " +
      `for ${missing.join(", ")} — the refusals of an end day before the start day, and of dates ` +
      "sent while the store's zone is unknown.",
  );
}

/**
 * The copy one whole-day write refuses in. A resolver may answer a reader's
 * locale with a pack the mount never saw; where that pack lacks a whole-day
 * sentence, the default rendering's (asserted at the mount) is said instead —
 * a true sentence, never the "must be after" that equal days would make false.
 */
export function wholeDayCopyFor(
  copy: DiscountsServerCopy,
  fallback: DiscountsServerCopy,
): DiscountsServerCopy {
  if (WHOLE_DAY_KEYS.every((key) => said(copy[key]))) return copy;
  return {
    ...copy,
    endsBeforeStartDay: said(copy.endsBeforeStartDay) ? copy.endsBeforeStartDay : fallback.endsBeforeStartDay,
    datesNeedKnownZone: said(copy.datesNeedKnownZone) ? copy.datesNeedKnownZone : fallback.datesNeedKnownZone,
  };
}
