"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * MEASURE A ROW, THEN DECIDE WHAT FITS — the two pieces every "…and the rest
 * goes in the menu" cluster needs, and the only two that are not specific to
 * what is being collapsed.
 *
 * It was extracted from `DataViews`' filter toolbar (`data-views-overflow`),
 * which still owns everything filter-shaped about that bar: what a pill costs,
 * that an APPLIED filter ranks ahead of an idle one, and the ladder that
 * strips the search and the counter. None of that generalises. What does is
 * the pair below — observe a container's width, and greedily keep what fits —
 * and a second copy of a resize-measurement loop is exactly the kind of thing
 * that drifts silently from the first.
 *
 * Both are presentation only: nothing here removes an action, changes a
 * handler, or decides that something should not be reachable. What does not
 * fit is meant to be rendered SOMEWHERE ELSE by the caller — a menu, a panel —
 * never dropped.
 */

/**
 * Observe an element's content width. `0` until the first measurement lands.
 *
 * Zero is a meaningful answer, not a missing one: an SSR pass and a jsdom test
 * both have no `ResizeObserver`, and the callers here read `0` as "degrade
 * nothing" — keep every control inline. That is the honest fallback, because
 * the alternative hides controls behind a trigger that the same environment
 * cannot show either.
 */
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(): {
  ref: RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** What one split costs the row, so a caller can price whatever comes next. */
export interface FitResult<Item> {
  /** Rendered on the row, in the order they were DECLARED. */
  inline: Item[];
  /** Everything that had no room, also in declared order. */
  overflow: Item[];
  /** Width the surviving items occupy, including the overflow trigger. */
  used: number;
}

export interface FitRequest<Item> {
  /** Rendered width of one item, however the caller prices it. */
  widthOf: (item: Item) => number;
  /** Stable identity — the split is decided as a set, then re-ordered. */
  keyOf: (item: Item) => string;
  /** The gap between two items, charged once per item kept. */
  gap: number;
  /** Room the items have to share, with fixed furniture already subtracted. */
  available: number;
  /**
   * What the overflow trigger costs — charged ONLY when something overflows,
   * because a row where everything fits renders no trigger at all.
   */
  overflowCost: number;
  /**
   * The order in which items claim the visible slots. Defaults to the declared
   * order; pass a re-ordering to rank some items ahead of others.
   *
   * Ranking is not exempting. A high-ranked item still overflows once even the
   * first slots run out, which is what stops a row of "important" items from
   * claiming more width than it has and painting past its own edge.
   */
  priority?: readonly Item[];
}

/**
 * Keep what fits, shed the rest — ONE AT A TIME, never all at once.
 *
 * The all-or-nothing version throws away room that was there: with four items
 * and space for three, hiding all four leaves the row emptier than it needed
 * to be.
 *
 * Items claim slots in `priority` order but are RENDERED in declared order:
 * which ones are visible may change with the width, and that is the point —
 * but the ones that stay must not reshuffle under the pointer.
 */
export function splitToFit<Item>(
  items: readonly Item[],
  request: FitRequest<Item>,
): FitResult<Item> {
  const { widthOf, keyOf, gap, available, overflowCost, priority } = request;
  const cost = (list: readonly Item[]): number =>
    list.reduce((sum, item) => sum + widthOf(item) + gap, 0);

  if (cost(items) <= available) {
    return { inline: [...items], overflow: [], used: cost(items) };
  }

  // There IS an overflow, so its trigger now costs room too.
  let room = available - overflowCost;
  const keep = new Set<string>();
  for (const item of priority ?? items) {
    const next = widthOf(item) + gap;
    if (next > room) continue;
    room -= next;
    keep.add(keyOf(item));
  }
  const inline = items.filter((item) => keep.has(keyOf(item)));
  return {
    inline,
    overflow: items.filter((item) => !keep.has(keyOf(item))),
    used: cost(inline) + overflowCost,
  };
}
