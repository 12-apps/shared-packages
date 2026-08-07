import { REPORT_RANGES, REPORT_RANGE_LABELS, type ReportRange } from "../reports-api";

/**
 * The next WIDER period, or null when there is none (FUT-391).
 *
 * An empty block is ambiguous: it can mean "nothing happened" or "you are
 * looking at too small a window", and those call for opposite reactions. The
 * common cause is the second — a store checking "Hoje" before lunch — so the
 * empty state offers the widening rather than leaving the author to find the
 * period selector and guess.
 *
 * `REPORT_RANGES` is ordered narrow → wide, so "wider" is the next entry. At
 * the widest, this returns null and the empty state says nothing extra: an
 * offer that cannot be taken is worse than no offer.
 */
export function widerRange(range: ReportRange): ReportRange | null {
  const index = REPORT_RANGES.indexOf(range);
  if (index < 0) return null;
  return REPORT_RANGES[index + 1] ?? null;
}

/** "Ver 30 dias" — the action label for widening to `range`. */
export function widenLabel(range: ReportRange): string {
  return `Ver ${REPORT_RANGE_LABELS[range]}`;
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
): { label: string; onClick: () => void } | undefined {
  const wider = widerRange(range);
  if (!wider) return undefined;
  return { label: widenLabel(wider), onClick: () => onRangeChange(wider) };
}
