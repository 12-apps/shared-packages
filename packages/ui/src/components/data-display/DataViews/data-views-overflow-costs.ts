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
   */
  return Math.round(text.length * 7.6) + 76 + extra;
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
  /** The "N de N" counter. */
  counter: 96,
  /** Exibir + Exportar WITH their text labels. */
  right: 216,
  /**
   * The same two controls as icons only — step 2 of the ladder.
   *
   * MEASURED at 133px for the pair (66 each: a Button's minimum tap target is
   * a good deal wider than the 20px glyph inside it), so the old 96 under-priced
   * them by a third and the row went on believing it had room it did not.
   */
  rightCompact: 140,
  /** What step 4 leaves behind: the search as a bare magnifier. */
  searchIcon: 44,
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
  /** The "Mais" button, only charged when there IS an overflow. */
  overflowButton: 104,
  /**
   * "Limpar", only charged when there IS something to clear.
   *
   * It appears exactly when the row is at its widest — every applied filter
   * has a longer label than the idle one it replaced — so leaving it unpriced
   * would break the line at the one moment the operator most needs it.
   * Measured at 64 as an icon; 72 with slack.
   */
  clearAll: 72,
  /** Gaps + the row's own padding. */
  chrome: 64,
} as const;

/** The gap between two controls. */
export const GAP = 8;
