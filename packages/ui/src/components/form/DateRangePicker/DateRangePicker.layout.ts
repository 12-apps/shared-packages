/**
 * Where the typed half goes when the consumer asked for it BESIDE the months
 * (`fieldsPlacement="beside"`), and how many months fit with it.
 *
 * Decided from the PICKER's own width, never the viewport's: the same form sits
 * full width on a computer and in a 3/5 column beside a preview on the same
 * computer, and only its own box knows which. The numbers are the design px the
 * month grid is built to (`MONTH_SX` in `CalendarMonth`: 304 wide, 24 apart).
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** A month grid's intrinsic width and the gap between two of them. */
const MONTH_PX = 304;
const MONTH_GAP_PX = 24;
/** The months' frame: 16px of padding a side and a 1px hairline. */
const FRAME_PX = 2 * 16 + 2;
/** The narrowest column a `dd/mm/aaaa` field and its label read well in. */
const FIELDS_MIN_PX = 220;
/** The gap between the frame and the fields beside it. */
export const BESIDE_GAP_PX = 32;

export type FieldsPlacement = 'beside' | 'below';

const framed = (months: number): number => months * MONTH_PX + (months - 1) * MONTH_GAP_PX + FRAME_PX;

/**
 * The layout for a picker `width` px wide asking for `requested` months, in
 * order of preference: every month requested with the fields beside, then
 * under them, then one month beside, then one under. A picker not measured yet
 * (no `ResizeObserver`, a server render) keeps the default layout.
 */
export function besideLayout(
  width: number | null,
  requested: number,
): { months: number; placement: FieldsPlacement } {
  if (width === null) return { months: requested, placement: 'below' };
  const counts = requested > 1 ? [requested, 1] : [requested];
  for (const months of counts) {
    if (width >= framed(months) + BESIDE_GAP_PX + FIELDS_MIN_PX) return { months, placement: 'beside' };
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
