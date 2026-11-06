import { windowCalendarDays } from "../timezone";
import type { DiscountsServerCopy } from "./copy";
import type { DiscountPage, DiscountRecord } from "./store";

/**
 * The store's zone, per tenant, as a host answers it (FUT-4482).
 *
 * A FUNCTION of the tenant, not a value: one host serves stores in different
 * zones, and only it knows which column holds a store's clock. Optional — see
 * `DiscountWindowOptions` for what a host that passes nothing keeps.
 */
export type StoreTimeZone = (clientId: string) => string | Promise<string>;

/** The tenant's zone, or undefined when the host counts no whole days. */
export async function zoneFor(
  storeTimeZone: StoreTimeZone | undefined,
  clientId: string,
): Promise<string | undefined> {
  return storeTimeZone === undefined ? undefined : await storeTimeZone(clientId);
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

/**
 * A host that counts whole days says the refusal that goes with them, which
 * the plain pack key cannot: equal days are legal there, so "must be after"
 * would be false. Asserted at the mount, where the wiring is written.
 */
export function assertWholeDayCopy(
  storeTimeZone: StoreTimeZone | undefined,
  copy: DiscountsServerCopy,
): void {
  if (storeTimeZone === undefined) return;
  if (typeof copy.endsBeforeStartDay === "string" && copy.endsBeforeStartDay.trim() !== "") return;
  throw new Error(
    "@12-apps/discounts: createApiDiscounts counts whole days (storeTimeZone) but is missing copy " +
      "for endsBeforeStartDay — the refusal of an end day before the start day.",
  );
}
