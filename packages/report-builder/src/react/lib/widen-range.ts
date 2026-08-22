import { reportRangeLabel, type ReportRange } from "../reports-api";
import type { ReportRangeCopy } from "../screens-copy";

/**
 * The widening ladder, narrow → wide. Its OWN list, and no longer the toggle's.
 *
 * Walking `REPORT_RANGES` was correct only while every preset on it was a fixed
 * lookback. Two are not (FUT-755). `month` is month-TO-DATE, so for the first
 * week of every month it is NARROWER than `7d` — offering it as the way to see
 * more would hand back fewer rows, which is the exact confusion the offer
 * exists to end. And `custom` names dates the empty state does not have, so
 * "Ver Personalizado…" would resolve to nothing at all.
 */
const WIDENING_LADDER: readonly ReportRange[] = ["today", "7d", "30d"];

/**
 * The next WIDER period, or null when there is none (FUT-391).
 *
 * An empty block is ambiguous: it can mean "nothing happened" or "you are
 * looking at too small a window", and those call for opposite reactions. The
 * common cause is the second — a store checking "Hoje" before lunch — so the
 * empty state offers the widening rather than leaving the author to find the
 * period selector and guess.
 *
 * A period that is not ON the ladder (`month`, `custom`) has no next entry:
 * null, and the empty state says nothing extra — an offer that cannot be taken
 * is worse than no offer.
 */
export function widerRange(range: ReportRange): ReportRange | null {
  const index = WIDENING_LADDER.indexOf(range);
  if (index < 0) return null;
  return WIDENING_LADDER[index + 1] ?? null;
}

/** "Ver 30 dias" — the action label for widening to `range`. */
export function widenLabel(range: ReportRange, copy: ReportRangeCopy): string {
  return copy.widen(reportRangeLabel(range, copy));
}

/**
 * The empty state's widen offer, or undefined at the widest period.
 *
 * Returning undefined rather than a disabled action is deliberate: an offer
 * the reader cannot take is worse than none, because it implies the emptiness
 * has a fix when at "30 dias" it means the data really is not there.
 */
export function widenAction(
  range: ReportRange,
  onRangeChange: (range: ReportRange) => void,
  copy: ReportRangeCopy,
): { label: string; onClick: () => void } | undefined {
  const wider = widerRange(range);
  if (!wider) return undefined;
  return { label: widenLabel(wider, copy), onClick: () => onRangeChange(wider) };
}
