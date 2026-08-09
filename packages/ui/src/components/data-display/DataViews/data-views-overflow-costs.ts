/**
 * WHAT EACH THING ON THE TOOLBAR COSTS, IN PIXELS.
 *
 * The pricing half of the collapse ladder, split from `data-views-overflow` at
 * the file-size gate. Pure arithmetic and constants: no React, no measurement,
 * no decisions. `data-views-overflow` measures the row and spends what this
 * says it has.
 *
 * Every number here is either MEASURED in a browser (and says so) or
 * deliberately generous. Over-pricing sheds one control too early, which the
 * "Mais" button absorbs invisibly; under-pricing breaks the line.
 */
import type { OverflowField } from "./data-views-overflow";
import type { RangeValue } from "./data-views-types";

/**
 * Rough rendered width of a control, in px.
 *
 * An ESTIMATE from the label text rather than a real measurement, deliberately:
 * measuring the true width needs every control mounted first, and mounting them
 * to decide whether to mount them is the layout thrash this hook exists to
 * avoid. The estimate only has to rank controls and find the cut point — being
 * a few px out moves the cut by at most one control, and the overflow catches it.
 */
export function estimateWidth(text: string, extra: number): number {
  /**
   * ~7.6px per character at the toolbar's font size, plus 76px of chrome:
   * horizontal padding, the border, and the dropdown chevron. The chrome used
   * to be 52, which under-priced every control by roughly a chevron's width —
   * six of them then "fitted" a row they overflowed, and because they are flex
   * children the row paid for it by squeezing labels to "D…" and "V…" rather
   * than by shedding a control into the overflow.
   *
   * Deliberately generous: over-pricing sheds one control too early, which the
   * "Mais" button absorbs invisibly. Under-pricing breaks the line.
   *
   * The chrome was 76, and generous had turned into wrong. MEASURED on the
   * Pedidos bar: "Pagamento" renders at 123px against an estimate of 144, and
   * "Situação" at 107 against 137 — every pill over-priced by ~22%, which on a
   * phone is the whole difference between one pill on the bar and none. 56 is
   * still above the ~50 measured, so the slack the comment above asks for is
   * intact; it is just slack rather than a second control's worth of budget.
   */
  return Math.round(text.length * 7.6) + 56 + extra;
}

/** Is a range bounded at either end? */
export function isRangeSet(range: RangeValue | undefined): boolean {
  return Boolean(range && (range.min !== undefined || range.max !== undefined));
}

/** The label a pill actually renders, which is what decides its width. */
export function pillText<T extends Record<string, unknown>>(field: OverflowField<T>, values: string[]): string {
  if (values.length === 0) return field.label;
  if (values.length === 1) {
    const option = field.pill?.options.find((entry) => entry.value === values[0]);
    return `${field.label}: ${option?.label ?? values[0]}`;
  }
  return `${field.label}: ${values.length}`;
}

/** Fixed toolbar furniture the filters have to fit around, in px. */
export const RESERVED = {
  /** The search box never shrinks below this. */
  search: 200,
  /**
   * The "N de N" counter.
   *
   * MEASURED at 35px, plus its divider and gap. The old 96 was priced for a
   * counter reading "1.234 de 5.678"; a phone shows "3 de 3", and charging
   * nearly triple its rendered width came straight out of the filter budget.
   */
  counter: 56,
  /**
   * ONE right-hand control (Exibir, or Exportar) WITH its text label.
   *
   * Priced per control rather than for the pair, because the pair is not what
   * every page renders: "Exportar" exists only when the host passes an
   * `exportConfig`, and several pages (Pedidos among them) put their export in
   * the PAGE HEADER instead. Charging 216 there billed the filters for a button
   * that was never on the bar — ~108px of budget spent on nothing, which on a
   * phone is the difference between one filter pill and none.
   */
  displayControl: 108,
  /**
   * The same control as an icon only — step 2 of the ladder.
   *
   * MEASURED at 133px for the PAIR (66 each: a Button's minimum tap target is
   * a good deal wider than the 20px glyph inside it); 70 keeps that total's
   * slack at one control's granularity.
   */
  displayControlCompact: 70,
  /**
   * What step 4 leaves behind: the search as a bare magnifier.
   *
   * MEASURED at 30px on the Pedidos bar (`…-search-all-collapsed`); 38 keeps a
   * tap target's worth of slack over it.
   */
  searchIcon: 38,
  /**
   * The narrowest keyword box still worth typing into — below it the operator
   * cannot read back what they wrote, and the box takes over the cluster
   * instead of sharing it (see `searchTakeover`).
   *
   * 120 rather than 140 because this is compared against the ESTIMATE, which
   * over-prices on purpose (see `estimateWidth`). At 140 a large phone took the
   * whole cluster to produce a box barely wider than the one it could have had
   * while keeping its filters — paying for nothing.
   */
  usableSearch: 120,
  /**
   * The "Mais" button, only charged when there IS an overflow — and priced by
   * the state it is actually in, like the right-hand cluster beside it.
   *
   * MEASURED: 128px with its label, badge and chevron; 69px once the ladder has
   * it down to icon + badge. One number for both was wrong in BOTH directions —
   * it under-priced the wide bar (the row's own failure mode) and over-priced
   * the narrow one by a whole pill.
   */
  overflowButton: 136,
  overflowButtonCompact: 80,
  /**
   * "Limpar", only charged when there IS something to clear.
   *
   * It appears exactly when the row is at its widest — every applied filter
   * has a longer label than the idle one it replaced — so leaving it unpriced
   * would break the line at the one moment the operator most needs it.
   * Measured at 64 as an icon; 72 with slack.
   */
  clearAll: 72,
  /**
   * The row's own padding, plus the gaps BETWEEN the fixed furniture.
   *
   * Not the per-control gaps — `splitFilters` already adds a `GAP` for every
   * filter it keeps, so counting a fourth one here charged one gap twice.
   * MEASURED: 32px of padding (16 each side) + three 8px gaps between the
   * search, the counter and the right cluster.
   */
  chrome: 56,
} as const;

/** The gap between two controls. */
export const GAP = 8;

/** What the right-hand cluster costs, given what the host actually renders. */
export function rightClusterCost(hasExport: boolean, compact: boolean): number {
  const one = compact ? RESERVED.displayControlCompact : RESERVED.displayControl;
  return hasExport ? one * 2 : one;
}

/**
 * What the toolbar furniture costs at a given rung of the ladder — the budget
 * the filter controls have to fit AROUND.
 *
 * This exists because the two halves used to disagree. `splitFilters` priced
 * the furniture at its widest (search 200 + counter 96 + right 216) and shed
 * every filter to make room; the ladder then collapsed those very controls to
 * 44 + 0 + 140 and nobody handed the ~330px back. On a 428px phone that showed
 * as a bar carrying a magnifier, a "Mais 5" pill, and a band of nothing.
 */
export function furnitureCost(
  flags: { searchCollapsed: boolean; counterHidden: boolean; compactControls: boolean },
  hasExport: boolean,
): number {
  return (
    (flags.searchCollapsed ? RESERVED.searchIcon : RESERVED.search) +
    (flags.counterHidden ? 0 : RESERVED.counter) +
    rightClusterCost(hasExport, flags.compactControls) +
    RESERVED.chrome
  );
}
