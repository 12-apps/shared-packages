import { isCalendarDay, isKnownTimeZone, wholeDayWindow } from "../timezone";
import type { DiscountsServerCopy } from "./copy";
import { DiscountValidationError, type DiscountWriteInput } from "./validate";

/**
 * The campaign window of a write: its two calendar days, checked and turned
 * into the instants the engine reads. Split from `./validate` for the file-size
 * gate; it is the same rule set, asserted from `toDiscountScalars`.
 */

function invalid(field: string, message: string): DiscountValidationError {
  return new DiscountValidationError(field, message);
}

/** A calendar date at UTC midnight, or null. The wire format is `YYYY-MM-DD`. */
function toDate(value: string | null, field: string, copy: DiscountsServerCopy): Date | null {
  if (value === null || value === "") return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw invalid(field, copy.invalidDate);
  return parsed;
}

/**
 * How a write reads its two calendar days (FUT-4482).
 *
 * `timeZone` — the STORE's IANA zone, which only the host knows — turns the
 * chosen days into WHOLE days on that clock: Início from its 00:00, Término
 * until the last instant of its day, and Início = Término a one-day promotion.
 *
 * Omitted, a write keeps the behaviour every adopter had before: each day is
 * UTC midnight and Término is the exclusive bound. That is the price of not
 * breaking an adopter that has not wired a zone; it is also why the omission
 * is never silent in a host that has — `createApiDiscounts` asks for the zone
 * per tenant, and dates sent while it is one the runtime does not know are
 * refused on the date field (`datesNeedKnownZone`).
 */
export interface DiscountWindowOptions {
  timeZone?: string;
}

/**
 * The window, half-open `[startsAt, endsAt)`.
 *
 * Without a zone, `endsAt` is the typed day itself, so equal bounds are an
 * EMPTY window rather than a one-instant one — an operator who typed the same
 * date twice meant something else, and an always-empty promotion is worse
 * than a rejected form. With one, the last day is inclusive and equal days are
 * a one-day promotion: only a Término BEFORE Início is refused.
 */
export function assertWindow(
  input: DiscountWriteInput,
  copy: DiscountsServerCopy,
  options: DiscountWindowOptions,
): { startsAt: Date | null; endsAt: Date | null } {
  if (options.timeZone !== undefined) return assertWholeDays(input, copy, options.timeZone);
  const startsAt = toDate(input.startsAt, "startsAt", copy);
  const endsAt = toDate(input.endsAt, "endsAt", copy);
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw invalid("endsAt", copy.endsBeforeStarts);
  }
  return { startsAt, endsAt };
}

/** A chosen day, checked: blank is null, anything else must name a real day. */
function toDay(value: string | null, field: string, copy: DiscountsServerCopy): string | null {
  if (value === null || value === "") return null;
  if (!isCalendarDay(value)) throw invalid(field, copy.invalidDate);
  return value;
}

/**
 * The whole-day refusal. Never `endsBeforeStarts` in its place: with whole days
 * equal days are legal, so "must be after" would be false — a caller counting
 * whole days without the sentence is a wiring mistake, said as one.
 */
function wholeDaySentence(copy: DiscountsServerCopy): string {
  const sentence = copy.endsBeforeStartDay;
  if (typeof sentence === "string" && sentence.trim() !== "") return sentence;
  throw new Error(
    "@12-apps/discounts: a write counting whole days (timeZone) needs copy.endsBeforeStartDay — " +
      "endsBeforeStarts says equal days are refused, which is false here.",
  );
}

/**
 * Dates sent while the store's zone is one the runtime does not know (review
 * round 5): they cannot be placed on its clock, so they are refused on the
 * first date field sent — the one refusal a date problem leaves, never the
 * edit's. No dates at all need no clock: an open window is open anywhere.
 *
 * ANSWERED, not thrown, so a PATCH can hold it until it has read the row
 * (review round 6): days equal to the ones the read showed are not a change,
 * and keep the stored window without a clock.
 */
export function unplaceableDays(
  days: { startsOn: string | null; endsOn: string | null },
  copy: DiscountsServerCopy,
  timeZone: string,
): DiscountValidationError | null {
  const { startsOn, endsOn } = days;
  if ((startsOn === null && endsOn === null) || isKnownTimeZone(timeZone)) return null;
  const sentence = copy.datesNeedKnownZone;
  if (typeof sentence !== "string" || sentence.trim() === "") {
    throw new Error(
      `@12-apps/discounts: dates sent while the store's zone "${timeZone}" is unknown need ` +
        "copy.datesNeedKnownZone to be refused with.",
    );
  }
  return invalid(startsOn === null ? "endsAt" : "startsAt", sentence);
}

/**
 * The two chosen days of a whole-day write, checked as days: each a real day
 * or blank, and Término not before Início. No clock is needed for that.
 */
export function checkedWholeDays(
  input: Pick<DiscountWriteInput, "startsAt" | "endsAt">,
  copy: DiscountsServerCopy,
): { startsOn: string | null; endsOn: string | null } {
  const startsOn = toDay(input.startsAt, "startsAt", copy);
  const endsOn = toDay(input.endsAt, "endsAt", copy);
  // ISO days sort as strings; equal is a one-day promotion.
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw invalid("endsAt", wholeDaySentence(copy));
  }
  return { startsOn, endsOn };
}

/** The FUT-4482 half: whole days on the store's clock. */
function assertWholeDays(
  input: DiscountWriteInput,
  copy: DiscountsServerCopy,
  timeZone: string,
): { startsAt: Date | null; endsAt: Date | null } {
  const days = checkedWholeDays(input, copy);
  const refusal = unplaceableDays(days, copy, timeZone);
  if (refusal !== null) throw refusal;
  if (days.startsOn === null && days.endsOn === null) return { startsAt: null, endsAt: null };
  return wholeDayWindow(days.startsOn, days.endsOn, timeZone);
}
