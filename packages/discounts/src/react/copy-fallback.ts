import { isPortuguese, languageTagOf, nearestPack } from "../pack-language";

import type { CompleteDiscountsWebCopy, DiscountsWebCopy, DiscountsWindowFallbackKey } from "./copy";
import { EN_US_DISCOUNTS_WEB_COPY } from "./en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";

/**
 * The sentences a host's web pack may leave out (review round 6). They were
 * added after the pack became host config, so requiring them would break
 * every host that wrote its own: a pack that has one says it, and one that
 * lacks it is answered from the package's own pack for the host's language —
 * pt-BR for a `pt` tag, en-US for any other.
 */

const WINDOW_KEYS: readonly DiscountsWindowFallbackKey[] = [
  "daysUnknown",
  "daysUnknownList",
  "daysUnknownForm",
  "daysUnknownBoxes",
  "daysUnknownPaused",
  "datesLockedForm",
  "datesLockedBoxes",
  "datesLockedList",
  "datesLockedCreate",
  "openTimeZone",
];

const CALENDAR_KEYS = ["locale", "label", "previousMonth", "nextMonth"] as const;

const said = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The package's own pack for a language tag: pt-BR for any `pt`, en-US otherwise. */
function packFor(tag: string): CompleteDiscountsWebCopy {
  return isPortuguese(tag) ? PT_BR_DISCOUNTS_WEB_COPY : EN_US_DISCOUNTS_WEB_COPY;
}

/** Whether a pack says every optional sentence itself. */
function isComplete({ window, form }: DiscountsWebCopy): boolean {
  const calendar = form.calendar ?? {};
  return (
    WINDOW_KEYS.every((key) => said(window[key])) &&
    CALENDAR_KEYS.every((key) => said(calendar[key])) &&
    said(form.endsBeforeStartDay)
  );
}

/**
 * A host's pack with every optional sentence filled in. `locale` is the host's
 * (`DiscountsWebConfig.locale`, or the surface's); without one the pack's own
 * calendar language decides, then the pack's words, then en-US. A missing
 * sentence comes from the package's pack for that language; a missing calendar
 * language is the HOST's own tag, so an `es-ES` host's months are Spanish while
 * its missing sentences are English (round 7). A complete pack comes back as
 * it is.
 */
export function completeWebCopy(copy: DiscountsWebCopy, locale?: string): CompleteDiscountsWebCopy {
  const { window, form } = copy;
  const calendar = form.calendar ?? {};
  // A declared calendar language as a BCP-47 tag (review round 8, N1): the
  // calendar hands it to `toLocaleDateString`, which throws on `pt_BR`.
  const declared = languageTagOf(calendar.locale);
  if (isComplete(copy) && declared === calendar.locale) return copy as CompleteDiscountsWebCopy;
  const tag = languageTagOf(locale) ?? languageTagOf(calendar.locale);
  const pack = tag ? packFor(tag) : nearestPack(copy, PT_BR_DISCOUNTS_WEB_COPY, EN_US_DISCOUNTS_WEB_COPY);
  const filledWindow = Object.fromEntries(
    WINDOW_KEYS.map((key) => [key, said(window[key]) ? window[key] : pack.window[key]]),
  ) as Pick<CompleteDiscountsWebCopy["window"], DiscountsWindowFallbackKey>;
  const filledCalendar = Object.fromEntries(
    CALENDAR_KEYS.map((key) => [key, said(calendar[key]) ? calendar[key] : pack.form.calendar[key]]),
  ) as CompleteDiscountsWebCopy["form"]["calendar"];
  return {
    ...copy,
    window: { ...window, ...filledWindow },
    form: {
      ...form,
      calendar: { ...filledCalendar, locale: declared ?? tag ?? pack.form.calendar.locale },
      endsBeforeStartDay: said(form.endsBeforeStartDay) ? form.endsBeforeStartDay : pack.form.endsBeforeStartDay,
    },
  };
}
