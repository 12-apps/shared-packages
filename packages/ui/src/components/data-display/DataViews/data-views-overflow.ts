"use client";

import { useRef } from "react";

import { splitToFit, useMeasuredWidth } from "../../utility/Overflow";
import {
  estimateWidth,
  furnitureCost,
  GAP,
  isRangeSet,
  pillText,
  RESERVED,
  rightClusterCost,
} from "./data-views-overflow-costs";
import type { FilterFieldConfig, RangeFieldConfig, RangeValue } from "./data-views-types";

/**
 * PROGRESSIVE COLLAPSE — which filter controls fit on the toolbar, measured.
 *
 * Two rules, and both come from watching the all-or-nothing version fail:
 *
 * 1. Controls shed ONE AT A TIME into an overflow, never all at once. With four
 *    filters and room for three, hiding all four throws away the room that was
 *    there.
 * 2. An APPLIED filter is ranked first, not exempt. Applied controls take the
 *    visible slots ahead of idle ones, and go into "Mais" like anything else
 *    when even those slots run out. Exempting them outright — the earlier rule
 *    — meant four applied filters on a phone claimed more width than the row
 *    had, and the bar painted past its own edge: the pills were reachable only
 *    by scrolling the toolbar sideways. Hiding one is safe because "Mais" says
 *    how many applied filters are behind it; scrolling one off-screen says
 *    nothing at all.
 *
 * It MEASURES rather than picking a breakpoint, which is what
 * `FILTERS-CONTRACT.md` asks for: pages declare different numbers of filters
 * with different label lengths, and the same page collapses at a different
 * width in another language. A shared breakpoint is wrong for at least one
 * table by construction.
 *
 * Collapsing is presentation only — nothing here emits a query, drops a filter
 * or changes a rendered row.
 */

/** A filter control on the bar: a multi-select pill or a min/max range. */
export interface OverflowField<T extends Record<string, unknown>> {
  id: string;
  label: string;
  /** Which control it is — the caller renders the right one. */
  group: "pill" | "range";
  pill?: FilterFieldConfig<T>;
  range?: RangeFieldConfig<T>;
}

/** What the caller renders inline, and what goes behind "Mais". */
export interface OverflowSplit<T extends Record<string, unknown>> {
  inline: OverflowField<T>[];
  overflow: OverflowField<T>[];
  /**
   * Step 2 — Exibir/Exportar drop their text labels and become icons.
   * Cheap: both keep their icon, their tooltip and their position.
   */
  compactControls: boolean;
  /**
   * Step 5, and the LAST resort — the "N de N" counter is dropped.
   *
   * Only once every control has already collapsed and the row STILL does not
   * fit, which on a six-filter table is below about 400px. The counter goes
   * last because it is the only thing left that reports rather than does: an
   * operator can act without knowing the total, but not without the search.
   */
  counterHidden: boolean;
  /**
   * Step 4 — the search collapses to a magnifier that expands on click.
   * The most expensive step, so it is taken last: the search is the one
   * control on the bar that cannot be guessed from an icon's position.
   */
  searchCollapsed: boolean;
  /**
   * Step 6, below even the counter — "Limpar" leaves the bar.
   *
   * The one control here with a second home: the overflow panel's footer
   * carries "Limpar todos os filtros". So it goes before the search icon or
   * "Mais", neither of which has anywhere else to be.
   */
  clearAllHidden: boolean;
  /**
   * Expanding the magnifier must take the whole cluster, filters and all.
   *
   * Only on the rungs where what is left over would be too narrow to read —
   * on a large phone the box simply shrinks and the filters stay, which is why
   * this is its own answer rather than `searchCollapsed` reused.
   */
  searchTakeover: boolean;
  /** Attach to the toolbar row being measured. */
  barRef: React.RefObject<HTMLDivElement | null>;
}

/** Every declared control, pills first, in the order the bar renders them. */
export function toOverflowFields<T extends Record<string, unknown>>(
  fields: FilterFieldConfig<T>[],
  rangeFields: RangeFieldConfig<T>[],
): OverflowField<T>[] {
  return [
    ...fields.map((pill) => ({ id: pill.id, label: pill.label, group: "pill" as const, pill })),
    ...rangeFields.map((range) => ({ id: range.id, label: range.label, group: "range" as const, range })),
  ];
}


/** Is this control carrying a value the operator set? */
function isActiveField<T extends Record<string, unknown>>(
  field: OverflowField<T>,
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): boolean {
  return field.group === "pill"
    ? (pills[field.id]?.length ?? 0) > 0
    : isRangeSet(ranges[field.id]);
}

/** Estimated rendered width of one control at its CURRENT value. */
function fieldWidth<T extends Record<string, unknown>>(
  field: OverflowField<T>,
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): number {
  if (field.group === "pill") return estimateWidth(pillText(field, pills[field.id] ?? []), 0);
  // A bounded range renders two number inputs beside its label.
  return estimateWidth(field.label, isRangeSet(ranges[field.id]) ? 100 : 0);
}

/** What one split costs on the bar, so the ladder below can price the next step. */
type Split<T extends Record<string, unknown>> = {
  inline: OverflowField<T>[];
  overflow: OverflowField<T>[];
  /** Width the surviving inline controls occupy, incl. the "Mais" button. */
  used: number;
};

/** Step 1 — shed filter controls into the overflow. Pure. */
function splitFilters<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
  width: number,
  /** Search + counter + right cluster + chrome, at the rung being considered. */
  furniture: number,
  /** Is the bar already down to icons? "Mais" shrinks with everything else. */
  compact: boolean,
): Split<T> {
  const active = all.filter((field) => isActiveField(field, pills, ranges));
  const idle = all.filter((field) => !isActiveField(field, pills, ranges));

  // "Limpar" rides the end of the cluster whenever anything is applied.
  const clearCost = active.length > 0 ? RESERVED.clearAll + GAP : 0;
  // APPLIED FIRST, BUT NOT EXEMPT.
  //
  // Applied controls take the visible slots ahead of idle ones — that part was
  // always right. Exempting them from the overflow entirely was not: applying
  // a value LENGTHENS a control ("Pagamento (1)"), so on a phone four applied
  // filters claimed more width than the row had and the bar simply painted
  // past its own edge, leaving pills reachable only by scrolling sideways.
  //
  // An applied filter hidden in "Mais" is not lost the way it would be if it
  // vanished silently: the trigger goes to the applied tone and says how many
  // are in there (see `MoreTrigger`), which is the same signal the pill itself
  // was carrying. A control you scroll off-screen carries no signal at all.
  //
  // The keep-what-fits loop itself is `splitToFit` (`utility/Overflow`) — the
  // one part of this that is not filter-shaped, and the part a second cluster
  // in the design system would otherwise have had to reimplement.
  const split = splitToFit(all, {
    widthOf: (field) => fieldWidth(field, pills, ranges),
    keyOf: (field) => field.id,
    gap: GAP,
    available: width - furniture - clearCost,
    // The overflow button at the width it will actually have, which on a phone
    // is the icon-and-badge one.
    overflowCost: compact ? RESERVED.overflowButtonCompact : RESERVED.overflowButton,
    priority: [...active, ...idle],
  });
  return { ...split, used: split.used + clearCost };
}

/**
 * THE DEGRADATION LADDER — cheapest loss first, and each rung taken only if
 * the one before it did not free enough:
 *
 *   1. filter controls move into the "Mais" overflow   (`splitFilters`)
 *   2. Exibir / Exportar drop their text labels        (`compactControls`)
 *   3. the search shrinks toward its minimum           (CSS: it is `flex: 1`)
 *   4. the search itself collapses to an icon          (`searchCollapsed`)
 *
 * Step 3 needs no flag — the search is a flex child, so it gives up width on
 * its own until it hits `RESERVED.search`. The flags mark the two steps that
 * change what is RENDERED rather than how wide it is.
 *
 * Measured against what is CURRENTLY on the bar, never a breakpoint: a
 * two-filter page and a five-filter page would otherwise collapse at the same
 * width, and only one of them would be right.
 */
function computeSplit<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
  width: number,
  /** Does the host render "Exportar" beside "Exibir"? Half the cluster if not. */
  hasExport: boolean,
): Omit<OverflowSplit<T>, "barRef"> {
  // Unmeasured (SSR, or jsdom without a ResizeObserver) ⇒ degrade nothing.
  if (width === 0) {
    return {
      inline: all,
      overflow: [],
      compactControls: false,
      counterHidden: false,
      searchCollapsed: false,
      clearAllHidden: false,
      searchTakeover: false,
    };
  }
  // Pass 1 prices the furniture at its widest — no rung has been taken yet.
  let split = splitFilters(all, pills, ranges, width, furnitureCost(UNCOLLAPSED, hasExport), false);
  let flags = ladderFlags(split, width, hasExport);
  // RE-SPEND WHAT THE LATER RUNGS FREED.
  //
  // Rungs 2/4/5 turn 200 + 96 + 216 of furniture into 44 + 0 + 140, and until
  // this loop existed nobody handed those ~330px back to the filters: the
  // split was decided once, against the uncollapsed row, so a phone shed every
  // control and then sat with a band of empty bar beside "Mais 5".
  //
  // Settles rather than oscillates, and cannot overfill: a cheaper furniture
  // can only give the filters MORE room, more filter width can only push the
  // ladder FURTHER down, and a further rung can only make the furniture
  // cheaper again — so the budget decreases monotonically and the loop exits
  // the moment it stops moving. The bound is a backstop, not the exit.
  let budget = furnitureCost(UNCOLLAPSED, hasExport);
  for (let pass = 0; pass < 3; pass += 1) {
    const freed = furnitureCost(flags, hasExport);
    if (freed >= budget) break;
    budget = freed;
    split = splitFilters(all, pills, ranges, width, budget, flags.compactControls);
    flags = ladderFlags(split, width, hasExport);
  }
  return { inline: split.inline, overflow: split.overflow, ...flags };
}

/** The widest the furniture ever is — every rung still untaken. */
const UNCOLLAPSED = { searchCollapsed: false, counterHidden: false, compactControls: false };

/** Rungs 2 and 4-6, priced against what the filters actually took. */
function ladderFlags<T extends Record<string, unknown>>(
  split: Split<T>,
  width: number,
  hasExport: boolean,
): Omit<OverflowSplit<T>, "barRef" | "inline" | "overflow"> {
  const { overflow, used } = split;
  const base = width - used - RESERVED.chrome;

  // Would the search still make its minimum with the labels on?
  const compactControls = base - RESERVED.counter - rightClusterCost(hasExport, false) < RESERVED.search;
  const rightCost = rightClusterCost(hasExport, compactControls);
  // …and with them off?
  const searchCollapsed = base - RESERVED.counter - rightCost < RESERVED.search;
  // Everything has collapsed and the row STILL overflows. The controls cannot
  // shrink further — they are `flexShrink: 0` precisely so an over-packed row
  // sheds rather than squeezes — so without this last rung they simply paint
  // outside the toolbar, which is what a narrow phone was doing.
  const counterHidden =
    searchCollapsed && base - RESERVED.counter - rightCost < RESERVED.searchIcon;
  // Step 6 — below even that, "Limpar" leaves the bar. It is the ONLY control
  // here with a second home: the overflow panel's footer carries "Limpar todos
  // os filtros", so nothing is lost, which is exactly why it goes before the
  // search icon or "Mais" (neither of which has anywhere else to be). Guarded
  // on there BEING an overflow, because with no panel the footer does not
  // exist and dropping this would strand the operator.
  const clearAllHidden = counterHidden && overflow.length > 0;
  // What the keyword box would get if the operator expanded the magnifier.
  // `searchCollapsed` is a different question — it asks whether the box fits at
  // its PREFERRED 200px, and is deliberately pessimistic — so reusing it to
  // decide the takeover evicted the filters on screens where the box had plenty
  // of room to simply shrink.
  //
  // Asked with the inline filters SHED, because shedding them is exactly what
  // expanding the box does: the row re-splits and they go behind "Mais".
  // Measuring against the resting row instead made a filter argue for its own
  // eviction — now that a large phone keeps one, its width came out of `base`,
  // pushed the box under `usableSearch`, and tipped a row that had ample space
  // to share into a full takeover.
  const overflowButton = compactControls
    ? RESERVED.overflowButtonCompact
    : RESERVED.overflowButton;
  const shedRoom = width - RESERVED.chrome - (overflow.length > 0 ? overflowButton : 0);
  const searchBoxRoom = shedRoom - (counterHidden ? 0 : RESERVED.counter) - rightCost;
  // Below this a box is too narrow to read what you typed into it, and shrinking
  // further buys nothing; that is the only point at which taking the whole
  // cluster is worth losing the filters.
  const searchTakeover = searchCollapsed && searchBoxRoom < RESERVED.usableSearch;

  return { compactControls, counterHidden, searchCollapsed, clearAllHidden, searchTakeover };
}

/**
 * Split the declared filter controls into what fits and what goes behind
 * "Mais", measured against the live toolbar width.
 *
 * Cached on a SIGNATURE rather than by `useMemo` over the inputs: hosts declare
 * their fields inline, so `all` is a fresh array on every render while the
 * configuration is unchanged, and a reference-keyed memo would never hit.
 */
export function useFilterOverflow<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
  /**
   * A filter control is open — hold the current answer until it closes.
   *
   * Applying a filter changes that control's LABEL ("Valor" becomes "Valor: ≥
   * R$ 1"), which changes its measured width, which re-runs the whole split
   * while its popover is open on top of it. Measured: setting a minimum moved
   * the trigger 192px left, took the popover with it, and pushed two other
   * controls into a newly-appeared "Mais 2" — so reaching for the second bound
   * meant chasing the control across the row. Nobody sets a range that way.
   *
   * Frozen only for the duration: closing re-measures against the new labels,
   * so the row still ends up correct, it just does not rearrange under a hand
   * that is mid-edit.
   */
  frozen = false,
  /** Whether "Exportar" is on the bar — see `rightClusterCost`. */
  hasExport = true,
): OverflowSplit<T> {
  // The measurement is `useMeasuredWidth` (`utility/Overflow`): the same
  // ResizeObserver every collapsing cluster in the design system reads, so
  // there is one loop to get right rather than one per bar. `0` until the
  // first measurement lands (and forever under SSR or jsdom), which
  // `computeSplit` reads as "degrade nothing".
  const { ref: barRef, width } = useMeasuredWidth<HTMLDivElement>();
  const signature = JSON.stringify({
    ids: all.map((field) => field.id),
    pills,
    ranges,
    width,
    hasExport,
  });
  const cache = useRef<{ signature: string; split: ReturnType<typeof computeSplit<T>> } | null>(null);
  if (cache.current === null || (!frozen && cache.current.signature !== signature)) {
    cache.current = { signature, split: computeSplit(all, pills, ranges, width, hasExport) };
  }
  return { ...cache.current.split, barRef };
}
