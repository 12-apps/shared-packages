/**
 * Where the typed half goes when the consumer asked for it BESIDE the months
 * (`fieldsPlacement="beside"`), and how many months fit with it.
 *
 * Decided from the PICKER's own width, never the viewport's: the same form sits
 * full width on a computer and in a 3/5 column beside a preview on the same
 * computer, and only its own box knows which. The numbers are the design px the
 * month grid is built to (`MONTH_SX` in `CalendarMonth`: 304 wide, 24 apart).
 */
import type { Theme } from '@mui/material/styles/index.js';
import { useLayoutEffect, useState, type RefObject } from 'react';

import { remPx } from '../../../tokens/relative';

/**
 * The design px the layout is computed from, rendered through the theme
 * (`remPx`) so a density that shrinks the grid shrinks the thresholds with it.
 * Framed months: the grid's intrinsic 304 a month and 24 between two
 * (`MONTH_SX`), plus the frame's 16px padding a side and its hairline. The
 * column beside: the `gap: 4` to the frame and the 220 a `dd/mm/aaaa` field
 * and its label read well in.
 */
const FRAMED_MONTHS: Readonly<Record<number, number>> = { 1: 338, 2: 666 };
const BESIDE_COLUMN = 252;

export type FieldsPlacement = 'beside' | 'below';

/** The design px a frame around `months` month grids needs (see FRAMED_MONTHS). */
export function framedMonthsWidth(months: number): number {
  return FRAMED_MONTHS[months] ?? (FRAMED_MONTHS[2]! * months) / 2;
}

/**
 * The layout for a picker `width` px wide asking for `requested` months, in
 * order of preference: every month requested with the fields beside, then
 * under them, then one month beside, then one under. A picker not measured yet
 * (no `ResizeObserver`, a server render) keeps the default layout.
 */
export function besideLayout(
  width: number | null,
  requested: number,
  theme: Theme,
): { months: number; placement: FieldsPlacement } {
  if (width === null) return { months: requested, placement: 'below' };
  const framed = (months: number): number => remPx(theme, framedMonthsWidth(months));
  const beside = remPx(theme, BESIDE_COLUMN);
  const counts = requested > 1 ? [requested, 1] : [requested];
  for (const months of counts) {
    if (width >= framed(months) + beside) return { months, placement: 'beside' };
    if (width >= framed(months)) return { months, placement: 'below' };
  }
  return { months: 1, placement: 'below' };
}

/** The element's content width, kept current; null until measured or when disabled. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return width;
}
