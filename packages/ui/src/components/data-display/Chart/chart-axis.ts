import type { ChartDataPoint, ChartProps } from './Chart.types';

/**
 * Cartesian axis + bar geometry: the rules that keep a chart readable rather
 * than merely correct (FUT-391 visual pass).
 *
 * Three of them are pass/fail by looking at the rendered chart:
 *
 * - **No overlapping text.** The bottom value tick sits ON the x-axis line and
 *   the first category tick sits ON the y-axis line, so the two labels meet at
 *   the corner. Recharts' default `tickMargin` of 2 leaves the category label's
 *   cap height inside the value label's descender — a few px of overlap at
 *   every viewport. The margin has to clear the value label's box, which grows
 *   with the font, hence a per-size value ({@link SIZE_PRESETS}).
 * - **Skip every nth tick, always keep the last, truncate at ~12 chars.** With
 *   more categories than fit, Recharts thins them only when it can measure text
 *   (never server-side, where `getStringSize` returns 0 and every label renders
 *   on top of its neighbour). Thinning here is deterministic and viewport-free.
 * - **Bars rounded, capped, never touching the frame.** A two-category bar
 *   chart in a wide card draws 150px slabs flush against the axis; the cap is
 *   what turns them back into bars.
 */

/** Category ticks kept before thinning starts. */
const DEFAULT_MAX_CATEGORY_TICKS = 8;
/** Category tick labels longer than this are truncated with an ellipsis. */
const DEFAULT_TICK_LABEL_MAX_CHARS = 12;
/** Bar corner radius, px. */
const DEFAULT_BAR_RADIUS = 3;
/** Cap on a single bar's thickness, px. */
const DEFAULT_MAX_BAR_WIDTH = 38;

/**
 * Thin a category axis to at most `maxTicks` labels, keeping every nth.
 *
 * The walk runs from the END so the last category is always labelled — the
 * most recent day/bucket is the one a reader looks for first. Returns
 * `undefined` when everything already fits, which leaves Recharts' own
 * width-aware thinning in charge of the common small-data case.
 *
 * Also `undefined` when a value repeats: Recharts places an explicit tick by
 * looking its value up in the scale, so a duplicate would land the label on
 * the first row that carries it rather than on the row it was picked for.
 */
export function selectCategoryTicks(
  values: ReadonlyArray<string | number>,
  maxTicks: number,
): Array<string | number> | undefined {
  if (maxTicks < 1 || values.length <= maxTicks) return undefined;
  if (new Set(values).size !== values.length) return undefined;
  const step = Math.ceil(values.length / maxTicks);
  const kept: Array<string | number> = [];
  for (let index = values.length - 1; index >= 0; index -= step) {
    const value = values[index];
    if (value !== undefined) kept.push(value);
  }
  return kept.reverse();
}

/** The category-axis values of `data`, in row order, skipping empty cells. */
export function categoryValues(
  data: ReadonlyArray<ChartDataPoint>,
  xAxisKey: string,
): Array<string | number> {
  const values: Array<string | number> = [];
  for (const row of data) {
    const value = row[xAxisKey];
    if (value !== null && value !== undefined) values.push(value);
  }
  return values;
}

/** Shorten a tick label to `maxChars`, ellipsis included, never mid-render. */
export function truncateTickLabel(value: unknown, maxChars: number): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (maxChars < 1 || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/** Resolved geometry for the shared cartesian axes. */
export interface CartesianAxisConfig {
  /** Gap between an axis line and its tick labels, px. */
  tickMargin: number;
  /** Explicit category ticks once thinning applies; `undefined` = Recharts decides. */
  categoryTicks: Array<string | number> | undefined;
  /** Category tick label formatter (truncation). */
  tickFormatter: (value: unknown) => string;
}

/** Resolved geometry for bar series. */
export interface BarGeometry {
  /** Per-corner radius, top corners only; `0` for stacked segments. */
  radius: number | [number, number, number, number];
  /** Cap on a bar's thickness, px — also what keeps bars off the frame. */
  maxBarSize: number;
}

export function resolveAxisConfig(props: ChartProps, tickMargin: number): CartesianAxisConfig {
  const maxChars = props.tickLabelMaxChars ?? DEFAULT_TICK_LABEL_MAX_CHARS;
  return {
    tickMargin,
    categoryTicks: selectCategoryTicks(
      categoryValues(props.data, props.xAxisKey ?? 'name'),
      props.maxCategoryTicks ?? DEFAULT_MAX_CATEGORY_TICKS,
    ),
    tickFormatter: (value: unknown) => truncateTickLabel(value, maxChars),
  };
}

export function resolveBarGeometry(props: ChartProps): BarGeometry {
  const radius = props.barRadius ?? DEFAULT_BAR_RADIUS;
  return {
    // A stacked segment rounded on its top corners tears a notch out of the
    // segment above it, so stacks stay square.
    radius: props.stacked ? 0 : [radius, radius, 0, 0],
    maxBarSize: props.maxBarWidth ?? DEFAULT_MAX_BAR_WIDTH,
  };
}
