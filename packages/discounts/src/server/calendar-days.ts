import { isKnownTimeZone, windowCalendarDays } from "../timezone";
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
 * The zone a READ places days on. A zone the runtime does not know cannot place
 * them, and a read is not where that must stop the screen: nothing is stored
 * from it, and every write still refuses that zone loudly. So the record is
 * answered without `startsOn`/`endsOn` — days placed on UTC would be other
 * days than the store's, and a form would show them as if they were — and the
 * logger says why.
 */
export async function readZoneFor(
  storeTimeZone: StoreTimeZone | undefined,
  clientId: string,
  logger: DiscountsLogger,
): Promise<string | undefined> {
  const zone = await zoneFor(storeTimeZone, clientId);
  if (zone === undefined || isKnownTimeZone(zone)) return zone;
  logger.warn(
    `discounts: unknown store time zone "${zone}" for tenant ${clientId} — answered without its days; ` +
      "every write is refused until the zone is one this runtime knows.",
  );
  return undefined;
}

/**
 * One record with the days it runs on, in the store's zone — what a form reads
 * back instead of re-deriving days from instants it cannot place on a clock.
 * Without a zone the record is answered exactly as the store built it.
 */
export function withCalendarDays<R extends Pick<DiscountRecord, "startsAt" | "endsAt">>(
  record: R,
  timeZone: string | undefined,
): R {
  if (timeZone === undefined) return record;
  return { ...record, ...windowCalendarDays(record.startsAt, record.endsAt, timeZone) };
}

/** Every row of a page, the same way. */
export function pageWithCalendarDays(page: DiscountPage, timeZone: string | undefined): DiscountPage {
  if (timeZone === undefined) return page;
  return { ...page, data: page.data.map((row) => withCalendarDays(row, timeZone)) };
}

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
  if (said(copy.endsBeforeStartDay)) return;
  throw new Error(
    "@12-apps/discounts: createApiDiscounts counts whole days (storeTimeZone) but is missing copy " +
      "for endsBeforeStartDay — the refusal of an end day before the start day.",
  );
}

/**
 * The copy one whole-day write refuses in. A resolver may answer a reader's
 * locale with a pack the mount never saw; where that pack has no whole-day
 * sentence, the default rendering's (asserted at the mount) is said instead —
 * a true sentence, never the "must be after" that equal days would make false.
 */
export function wholeDayCopyFor(
  copy: DiscountsServerCopy,
  fallback: DiscountsServerCopy,
): DiscountsServerCopy {
  if (said(copy.endsBeforeStartDay)) return copy;
  return { ...copy, endsBeforeStartDay: fallback.endsBeforeStartDay };
}
