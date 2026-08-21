import type { DiscountWindowState } from "../engine/kinds";

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
): DiscountListItem {
  return {
    ...record,
    bundlePriceCents: record.bundlePriceCents ?? null,
    valueLabel: formatDiscountValue(record, formatters),
    windowLabel: formatWindow(record, formatters, copy),
    windowState: windowStateOf(record, now),
    record,
  };
}
