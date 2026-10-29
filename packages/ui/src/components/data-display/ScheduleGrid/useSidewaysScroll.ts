import type * as React from 'react';
import { useRef } from 'react';

import { SCHEDULE_GRID_METRICS as M } from './ScheduleGrid.metrics';

/** What the grid wires onto its header frame and its days. */
export interface SidewaysScroll {
  /** On the days' scroll: the header row follows. */
  follow: () => void;
  /** On the header's wheel: a sideways wheel or trackpad swipe over it scrolls the days. */
  forwardWheel: (event: React.WheelEvent<HTMLElement>) => void;
  /** On the days' focus: a cell the keyboard reaches is brought fully into view. */
  bringOut: (event: React.FocusEvent<HTMLElement>) => void;
  /** A press began: the focus it starts is the pointer's, and is left where it is. */
  press: () => void;
  /** The press ended, or the keyboard took over. */
  release: () => void;
}

/** How far a focused element's ring reaches outside it. */
function ringOf(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const width = Number.parseFloat(style.outlineWidth) || 0;
  const offset = Math.max(0, Number.parseFloat(style.outlineOffset) || 0);
  return width + offset;
}

/**
 * Whether this focus is the keyboard's (or a script's after a key). A tap's focus arrives after
 * its pointerup, so the press flag alone would miss it; the browser's own heuristic does not.
 */
function keyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true; // an engine without the selector: the press flag still guards the pointer
  }
}

/** The nearest ancestor that scrolls up and down, or the page. */
function verticalScroller(from: HTMLElement): HTMLElement | null {
  for (let node = from.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** How far `target` sits left of the pinned names, or past the days' right edge (negative). */
function sidewaysOverflow(body: HTMLElement, target: HTMLElement, ring: number): number {
  const box = target.getBoundingClientRect();
  const row = target.closest('[role="row"]');
  const names = row?.querySelector('[role="rowheader"]');
  if (row && names && !target.closest('[role="rowheader"]')) {
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const underNames = names.getBoundingClientRect().right + gap - box.left;
    if (underNames > 0) return underNames;
  }
  const right = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
  const pastRight = box.right + ring - right;
  return pastRight > 0 ? -pastRight : 0;
}

/**
 * The header row follows the days sideways, so each day's header stays over
 * its column; only the days drive (the header is never a scroller of its own,
 * so it is never a tab stop). And a cell the keyboard focuses is brought fully
 * into view: out from under the pinned names, in from past the right edge, and
 * down from under the sticky header — the browser counts a cell under a sticky
 * column or header as already in view. A press (mouse, pen, a tap) is left
 * alone: scrolling then would move the cell out from under the pointer and lose
 * the click.
 */
export function useSidewaysScroll(
  headRef: React.RefObject<HTMLElement | null>,
  bodyRef: React.RefObject<HTMLElement | null>,
): SidewaysScroll {
  const pressing = useRef(false);
  const follow = (): void => {
    const head = headRef.current;
    const body = bodyRef.current;
    if (head && body && head.scrollLeft !== body.scrollLeft) head.scrollLeft = body.scrollLeft;
  };
  const forwardWheel = (event: React.WheelEvent<HTMLElement>): void => {
    const body = bodyRef.current;
    if (!body) return;
    const sideways = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (sideways) body.scrollLeft += event.deltaMode === 1 ? sideways * M.wheelLine : sideways;
  };
  const bringOut = (event: React.FocusEvent<HTMLElement>): void => {
    const body = bodyRef.current;
    const head = headRef.current;
    const target = event.target;
    if (pressing.current || !body || !(target instanceof HTMLElement) || !keyboardFocus(target)) return;
    const ring = ringOf(target);
    const sideways = sidewaysOverflow(body, target, ring);
    if (sideways) body.scrollLeft -= sideways;
    if (!head) return;
    const underHeader = head.getBoundingClientRect().bottom + ring - target.getBoundingClientRect().top;
    if (underHeader <= 0) return;
    const scroller = verticalScroller(body);
    if (scroller) scroller.scrollTop -= underHeader;
    else window.scrollBy(0, -underHeader);
  };
  return {
    follow,
    forwardWheel,
    bringOut,
    press: () => {
      pressing.current = true;
    },
    release: () => {
      pressing.current = false;
    },
  };
}
