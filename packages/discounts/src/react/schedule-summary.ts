import type { DiscountSchedule, DiscountScheduleWindow } from "../engine/schedule";
import { toMinutes } from "../engine/schedule";

import { fill, type DiscountsWebCopy } from "./copy";

/**
 * The read-back sentence: "Toda sexta, das 16:00 às 20:00." (FUT-996)
 *
 * The highest-value thing on the schedule editor. A row of day chips and two
 * clocks is DATA; this is the promise the operator is actually making, in the
 * words they would use to describe it out loud, and it is the only thing on the
 * screen they can check against what they meant.
 *
 * It follows `summaryOf` in the free-units builder exactly: **nothing is
 * rendered until the values make a real offer.** A sentence over a half-built
 * window would read as confirmation of something the validator is about to
 * refuse, which is worse than no sentence at all.
 *
 * Its own module because it is pure string assembly the builder, the grid cell
 * and the card all want, and a copy of it in each is how three surfaces start
 * describing one promotion three ways.
 */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];

function sameDays(days: readonly number[], expected: readonly number[]): boolean {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length === expected.length && unique.every((day, i) => day === expected[i]);
}

/**
 * The day set as a phrase.
 *
 * Collapsed sets come first so a common week reads as a phrase rather than a
 * list — "De segunda a sexta" beats "segunda, terça, quarta, quinta e sexta",
 * which is the same fact spelled at four times the length.
 *
 * A SINGLE day uses the pack's `dayEvery` form ("Toda sexta", "Todo sábado")
 * rather than the bare name, because that is how a merchant says it. The
 * article follows the day's gender in Portuguese, which is why the pack carries
 * all seven rather than the code prefixing a word.
 */
function formatDays(days: readonly number[], copy: DiscountsWebCopy): string | null {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  if (unique.some((day) => day < 0 || day > 6)) return null;
  const { schedule } = copy;
  if (sameDays(unique, ALL_DAYS)) return schedule.allDays;
  if (sameDays(unique, WEEKDAYS)) return schedule.weekdays;
  if (sameDays(unique, WEEKEND)) return schedule.weekend;
  if (unique.length === 1) return schedule.dayEvery[unique[0] as number] ?? null;
  const names = unique.map((day) => schedule.dayLong[day] ?? String(day));
  const last = names[names.length - 1] as string;
  return names.slice(0, -1).join(schedule.listSeparator) + schedule.listLast + last;
}

/**
 * One window as a sentence, or null when it is not yet an offer.
 *
 * An overnight window gets its OWN sentence rather than the same one, because
 * "das 22:00 às 02:00" is ambiguous on a screen and unambiguous only once it
 * says which day the 02:00 belongs to. An operator who typed it by mistake sees
 * it; one who meant it gets confirmation.
 */
export function formatScheduleWindow(
  window: DiscountScheduleWindow,
  copy: DiscountsWebCopy,
): string | null {
  const days = formatDays(window.days, copy);
  const from = toMinutes(window.from);
  const to = toMinutes(window.to);
  if (days === null || from === null || to === null || from === to) return null;
  const template = to < from ? copy.schedule.summaryOvernight : copy.schedule.summary;
  return fill(template, { days, from: window.from, to: window.to });
}

/**
 * The COMPACT form for a grid cell: "sex 16:00–20:00", plus "+N" when the rule
 * has more windows than the column can show.
 *
 * Short day names rather than the sentence, because a table cell is read in a
 * column of forty and the sentence is read once, deliberately, in a form.
 */
export function formatScheduleCell(
  schedule: DiscountSchedule | null | undefined,
  copy: DiscountsWebCopy,
): string | null {
  if (schedule === null || schedule === undefined) return null;
  const [first, ...rest] = schedule.windows;
  if (first === undefined) return null;
  const days = [...new Set(first.days)]
    .sort((a, b) => a - b)
    .map((day) => copy.schedule.dayShort[day] ?? String(day))
    .join(" ");
  const head = `${days} ${first.from}–${first.to}`;
  if (rest.length === 0) return head;
  return `${head} ${fill(copy.schedule.moreWindows, { count: rest.length })}`;
}
