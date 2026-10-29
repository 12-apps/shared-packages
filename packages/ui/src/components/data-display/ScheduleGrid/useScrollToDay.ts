import type * as React from 'react';
import { useLayoutEffect } from 'react';

/**
 * How far the days must scroll sideways for `day` to be the first column after
 * the pinned names — read off the header row, which is drawn while loading and
 * follows the body, so its geometry is the body's.
 */
function offsetOf(head: HTMLElement, day: number): number | null {
  const row = head.querySelector<HTMLElement>('[role="row"]');
  const corner = row?.querySelector<HTMLElement>('[data-sg-corner]');
  const column = row?.querySelectorAll<HTMLElement>('[role="columnheader"]')[day];
  if (!row || !corner || !column) return null;
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  return column.getBoundingClientRect().left - (corner.getBoundingClientRect().right + gap);
}

/**
 * `scrollToDay`: when it is set, and each time its value (or the day count)
 * changes, the days scroll sideways so that day opens first after the pinned
 * names. At once, never smoothly — so it needs no reduced-motion branch — and
 * only sideways: no `scrollIntoView`, which would also move the page, and no
 * focus. The header follows through `follow`. A re-render with the same value
 * leaves the person's own scroll alone. While the days fit there is nothing to
 * scroll and nothing happens; the browser clamps a day past the reach.
 */
export function useScrollToDay(
  headRef: React.RefObject<HTMLElement | null>,
  bodyRef: React.RefObject<HTMLElement | null>,
  day: number | undefined,
  dayCount: number,
  follow: () => void,
): void {
  useLayoutEffect(() => {
    const head = headRef.current;
    const body = bodyRef.current;
    if (day === undefined || !head || !body || !Number.isInteger(day) || day < 0 || day >= dayCount) return;
    const offset = offsetOf(head, day);
    if (offset === null) return;
    // The browser clamps a target outside the reach, on either side. The two-number form scrolls
    // as the scroller's `scroll-behavior` says, which `scrollSx` pins to `auto`: instant.
    const target = body.scrollLeft + offset;
    if (typeof body.scrollTo === 'function') body.scrollTo(target, body.scrollTop);
    else body.scrollLeft = target;
    follow();
    // `follow` is a fresh closure each render over the same refs: only the day (or the day count)
    // moves this, never a re-render.
  }, [day, dayCount, headRef, bodyRef]);
}
