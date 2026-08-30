import { useMemo } from "react";

import type { DiscountWindowState } from "../engine/kinds";
import { scheduleCovers } from "../engine/schedule";
import { resolveLocalClock } from "../timezone";

import type { DiscountWireRecord } from "./api";
import type { DiscountsWebCopy } from "./copy";
import { formatDiscountValue, formatWindow, windowStateOf, type DiscountsFormatters } from "./format";

/**
 * One wire record plus the three strings the grid, the cards and the export all
 * show.
 *
 * Derived ONCE per page render rather than inside a cell, and that is two
 * decisions in one. Basis-point arithmetic and date formatting run once per row
 * instead of once per re-render; and the grid, the card and the exported file
 * then read the SAME string, so the three cannot disagree about what a
 * promotion is worth — which they did, in the origin, until this shape existed.
 */
export interface DiscountListItem extends Record<string, unknown> {
  id: string;
  name: string;
  type: string;
  percentOffBp: number | null;
  amountOffCents: number | null;
  bundlePriceCents: number | null;
  scope: string;
  trigger: string;
  code: string | null;
  startsAt: string | null;
  endsAt: string | null;
  minSubtotalCents: number | null;
  usageLimit: number | null;
  perBuyerLimit: number | null;
  usageCount: number;
  stackable: boolean;
  active: boolean;
  categoryIds: string[];
  menuItemIds: string[];
  /** Pre-formatted: what it takes off. */
  valueLabel: string;
  /** Pre-formatted: the validity sentence. */
  windowLabel: string;
  /** Where it sits relative to its window, as a stable wire token. */
  windowState: DiscountWindowState;
  /**
   * Whether this rule's weekly SCHEDULE is running at this moment (FUT-996).
   *
   * Deliberately not folded into {@link windowState}. Those three values are
   * resolved by a store-side SQL predicate so the grid's filter pill and the
   * badge on a row cannot disagree — and a recurrence predicate is not
   * expressible there. Widening the enum would mean offering a filter the
   * backend cannot serve.
   *
   * So the pill keeps meaning the CAMPAIGN, and this answers the operator's
   * actual question ("is my happy hour on right now?") as a row-level dot
   * computed here. The cost, stated: you cannot FILTER by it.
   *
   * `false` for a rule with no schedule — there is nothing intermittent to
   * report, and a dot on every row would say nothing.
   */
  activeNow: boolean;
  /** The record itself, for the edit dialog to re-seed from. */
  record: DiscountWireRecord;
}

/**
 * @param now ONE instant for the whole page, passed in rather than read here:
 * two rows judged against two different "now"s could disagree about which of
 * them is still running, and on a list of forty that difference is invisible.
 */
export function toListItem(
  record: DiscountWireRecord,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
  now: Date,
  /** The store's IANA zone. Omitted ⇒ no live dot; see {@link DiscountListItem.activeNow}. */
  timezone?: string,
): DiscountListItem {
  return {
    ...record,
    bundlePriceCents: record.bundlePriceCents ?? null,
    valueLabel: formatDiscountValue(record, formatters),
    windowLabel: formatWindow(record, formatters, copy),
    windowState: windowStateOf(record, now),
    activeNow: isRunningNow(record, now, timezone),
    record,
  };
}

/**
 * Is this rule's schedule running right now, in the STORE's timezone?
 *
 * Answered with the same `scheduleCovers` the evaluator screens with — never a
 * second implementation, or the dot and the price a shopper is charged would
 * disagree about the same minute.
 */
function isRunningNow(
  record: DiscountWireRecord,
  now: Date,
  timezone: string | undefined,
): boolean {
  if (record.schedule == null || timezone === undefined) return false;
  const clock = resolveLocalClock(now, timezone);
  // An unresolvable zone means "we do not know", which must not be drawn as a
  // confident "on" — `scheduleCovers` answers TRUE for a null clock because a
  // cart must keep pricing, and that is the wrong default for an indicator.
  return clock !== null && scheduleCovers(record.schedule, clock);
}

/**
 * The grid's rows, derived once per page load.
 *
 * ONE instant for the whole render: two rows judged against two different
 * "now"s could disagree about which of them is still running, and on a list of
 * forty that difference is invisible. A hook rather than an inline `useMemo`
 * because {@link DiscountsScreen} sits at the size gate's ceiling.
 */
export function useDiscountRows(
  records: readonly DiscountWireRecord[] | undefined,
  formatters: DiscountsFormatters,
  copy: DiscountsWebCopy,
  timezone: string | undefined,
): DiscountListItem[] {
  return useMemo(() => {
    const now = new Date();
    return (records ?? []).map((record) => toListItem(record, formatters, copy, now, timezone));
  }, [records, formatters, copy, timezone]);
}
