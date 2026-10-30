import type * as React from 'react';
import { useLayoutEffect, useRef } from 'react';

/**
 * How far the days must scroll sideways for `day` to be the first column after
 * the pinned names, measured on the header row — or `null` when the header is
 * not laid out (no box: `display: none`, or a container that has no width yet).
 */
function offsetOf(head: HTMLElement, day: number): number | null {
  const row = head.querySelector<HTMLElement>('[role="row"]');
  const corner = row?.querySelector<HTMLElement>('[data-sg-corner]');
  const column = row?.querySelectorAll<HTMLElement>('[role="columnheader"]')[day];
  if (!row || !corner || !column) return null;
  const cornerBox = corner.getBoundingClientRect();
  const columnBox = column.getBoundingClientRect();
  if (cornerBox.width === 0 || columnBox.width === 0) return null;
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  return columnBox.left - (cornerBox.right + gap);
}

/**
 * Scroll the days so `day` opens first. The offset is the header's, so it is
 * added to the HEADER's scroll (the two can differ until the body's scroll
 * event has synced them); the body then jumps there, and the header follows.
 * Returns whether it could measure.
 */
function anchor(head: HTMLElement, body: HTMLElement, day: number, follow: () => void): boolean {
  const offset = offsetOf(head, day);
  if (offset === null) return false;
  // The browser clamps a target outside the reach, on either side.
  const target = head.scrollLeft + offset;
  if (typeof body.scrollTo === 'function') body.scrollTo({ left: target, behavior: 'instant' });
  else body.scrollLeft = target;
  follow();
  return true;
}

/** Whether `day` names one of the `dayCount` columns. */
function isColumn(day: number | undefined, dayCount: number): day is number {
  return day !== undefined && Number.isInteger(day) && day >= 0 && day < dayCount;
}

/** Whether this value was already anchored (a re-render, a refetch): the person's scroll stays. */
function sameAnchor(done: { day: number; dayCount: number } | null, day: number, dayCount: number): boolean {
  return done !== null && done.day === day && done.dayCount === dayCount;
}

interface Anchoring {
  day: number | undefined;
  dayCount: number;
  /** The days are drawn: not loading, no error, at least one row. */
  drawn: boolean;
}

/**
 * `scrollToDay`: once per value (and per day count), as soon as the days are
 * drawn, they scroll sideways so that day opens first after the pinned names.
 * At once (`behavior: 'instant'`, and `scrollSx` pins the scroller's own
 * `scroll-behavior` to `auto` too), so there is no motion to reduce; only
 * sideways — no `scrollIntoView`, which would also move the page — and no
 * focus. LTR: it reads the names as the left column.
 *
 * - The same value on a later render — a re-render, a refetch's
 *   `loading` → loaded — leaves the person's own scroll alone.
 * - While loading (or empty, or failed) it waits for the rows, then anchors.
 * - When the header has no box yet (`display: none`, a container sized after
 *   mount) it waits for the first width — a one-shot `ResizeObserver` on the
 *   header — then anchors and stops observing.
 * - A later resize does not re-anchor.
 */
export function useScrollToDay(
  headRef: React.RefObject<HTMLElement | null>,
  bodyRef: React.RefObject<HTMLElement | null>,
  { day, dayCount, drawn }: Anchoring,
  follow: () => void,
): void {
  const done = useRef<{ day: number; dayCount: number } | null>(null);
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    followRef.current = follow;
  });
  useLayoutEffect(() => {
    const head = headRef.current;
    const body = bodyRef.current;
    if (!isColumn(day, dayCount) || sameAnchor(done.current, day, dayCount)) return undefined;
    if (!drawn || !head || !body) return undefined;
    const settle = (): boolean => {
      if (!anchor(head, body, day, () => followRef.current())) return false;
      done.current = { day, dayCount };
      return true;
    };
    if (settle() || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (settle()) observer.disconnect();
    });
    observer.observe(head);
    return () => observer.disconnect();
  }, [day, dayCount, drawn, headRef, bodyRef]);
}
