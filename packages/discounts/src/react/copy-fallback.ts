import type { CompleteDiscountsWebCopy, DiscountsWebCopy, DiscountsWindowFallbackKey } from "./copy";
import { EN_US_DISCOUNTS_WEB_COPY } from "./en-US";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";

/**
 * The sentences a host's web pack may leave out (review round 6). They were
 * added after the pack became host config, so requiring them would break
 * every host that wrote its own: a pack that has one says it, and one that
 * lacks it is answered from the package's own pack for the host's language —
 * pt-BR for a `pt` tag, en-US for any other or none.
 */

const WINDOW_KEYS: readonly DiscountsWindowFallbackKey[] = [
  "daysUnknown",
  "daysUnknownList",
  "daysUnknownForm",
  "daysUnknownBoxes",
  "daysUnknownPaused",
  "openTimeZone",
];

const CALENDAR_KEYS = ["locale", "label", "previousMonth", "nextMonth"] as const;

const said = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The package's own pack for a language tag. */
function packFor(locale: string | undefined): CompleteDiscountsWebCopy {
  return /^pt(?:-|$)/iu.test(locale ?? "") ? PT_BR_DISCOUNTS_WEB_COPY : EN_US_DISCOUNTS_WEB_COPY;
}

/**
 * A host's pack with every optional sentence filled in. `locale` is the host's
 * (`DiscountsWebConfig.locale`); without one the pack's own calendar language
 * decides, and en-US after that. A complete pack comes back as it is.
 */
export function completeWebCopy(copy: DiscountsWebCopy, locale?: string): CompleteDiscountsWebCopy {
  const { window, form } = copy;
  const calendar = form.calendar ?? {};
  const complete =
    WINDOW_KEYS.every((key) => said(window[key])) &&
    CALENDAR_KEYS.every((key) => said(calendar[key])) &&
    said(form.endsBeforeStartDay);
  if (complete) return copy as CompleteDiscountsWebCopy;
  const pack = packFor(locale ?? calendar.locale);
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
      calendar: filledCalendar,
      endsBeforeStartDay: said(form.endsBeforeStartDay) ? form.endsBeforeStartDay : pack.form.endsBeforeStartDay,
    },
  };
}
