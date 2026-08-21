/**
 * Presentation compatibility matrix + smart defaults (FUT-308) — the
 * compiler's chart-shape rules (`assertChartShape`) expressed as DATA, so
 * authoring surfaces (builder UI, MCP docs) can offer only what the compiler
 * accepts instead of round-tripping a 400.
 *
 * The matrix is a SUPERSET of the compiler's rules, in one deliberate place:
 * the ordered-axis rule below is enforced here and NOT by `assertChartShape`
 * (FUT-755). A dedicated test pins both halves — that everything the matrix
 * offers still compiles, and that this is the only rule the two differ on.
 */
import type { PresentationCopy } from './copy';
import type { ReportPresentation } from './spec';

/** The shape facts the chart rules depend on. */
export interface SpecShape {
  dimensionCount: number;
  measureCount: number;
  /**
   * Whether the AXIS dimension (the first one — a second is a split, drawn as
   * one series per value) has a meaningful order. See {@link isOrderedDimension}.
   */
  firstDimensionIsOrdered: boolean;
}

/**
 * The catalog facts the axis rule reads off a field. Deliberately structural,
 * with `type: string` rather than `FieldType`, so ONE predicate serves both
 * the engine (`FieldDef`) and the builder (the wire's field listing, whose
 * `type` is a plain string) — the picker and the renderer cannot then drift on
 * what counts as ordered.
 */
export interface AxisFieldFacts {
  type: string;
  ordered?: boolean;
}

/**
 * Field types ordered INHERENTLY: their values carry a magnitude, so the
 * distance between two of them is a real quantity a slope can stand for.
 */
const ORDERED_FIELD_TYPES: ReadonlySet<string> = new Set(['date', 'number', 'money']);

/**
 * Whether a dimension may be a line's or an area's axis (FUT-755).
 *
 * `date` / `number` / `money` qualify by type. `string` and `boolean` do not,
 * unless the catalog declares `ordered` — which is how an encoded ordinal such
 * as an hour-of-day (`"00"`–`"23"`) says so. A field the caller cannot resolve
 * — an unknown name, a half-filled draft row — is treated as UNORDERED, so the
 * fallback is the offer that is always honest: bars.
 */
export function isOrderedDimension(field: AxisFieldFacts | undefined): boolean {
  if (!field) return false;
  return ORDERED_FIELD_TYPES.has(field.type) || field.ordered === true;
}

/**
 * Every presentation an author can pick, in the order the picker draws them
 * (`prototype.html`'s `VIZ`): the four that answer "how should this look"
 * first, then the three that are a choice about shape.
 */
export const PRESENTATION_OPTIONS = ['kpi', 'line', 'bar', 'area', 'table', 'pie', 'donut'] as const;
export type PresentationOption = (typeof PRESENTATION_OPTIONS)[number];

export interface PresentationCompatibility {
  option: PresentationOption;
  /** null = the compiler accepts this presentation; else the host's reason. */
  disabledReason: string | null;
}

/**
 * The ordered-axis rule (FUT-755): a line or an area draws the space BETWEEN
 * two points as though it were data. Over payment methods that space is a
 * fiction — half-way between CARD and PIX is not a value — so the slope states
 * a relationship that does not exist. Bars claim nothing about the gap, which
 * is why the same grouping is always offerable as bars.
 *
 * It tests the FIRST dimension only, because that is the axis in both the
 * single and the split case (`render.ts` builds `xAxis` from `dimensions[0]`
 * either way). A split over a DATE axis stays legitimate — its second
 * dimension becomes series, and the x-axis is still time.
 */
function unorderedAxisReason(
  option: PresentationOption,
  shape: SpecShape,
  copy: PresentationCopy,
): string | null {
  const drawsSlopes = option === 'line' || option === 'area';
  return drawsSlopes && !shape.firstDimensionIsOrdered ? copy.lineNeedsOrderedAxis : null;
}

function chartReason(
  option: PresentationOption,
  shape: SpecShape,
  copy: PresentationCopy,
): string | null {
  const isRound = option === 'pie' || option === 'donut';
  if (shape.dimensionCount > 1) {
    if (isRound) return copy.roundTakesNoSplit;
    // A split already spends the series axis; a second measure would need a
    // third one. The compiler rejects it, so the picker must too.
    if (shape.measureCount !== 1) return copy.splitTakesOneMeasure;
    return unorderedAxisReason(option, shape, copy);
  }
  if (isRound && shape.measureCount !== 1) return copy.roundTakesOneMeasure;
  return unorderedAxisReason(option, shape, copy);
}

/**
 * What an UNGROUPED spec may be drawn as (FUT-755): `Número`, and nothing else.
 *
 * One row is the whole result, so every other presentation is a way of drawing
 * one row badly — a table with a header and a single line, a bar chart with one
 * bar, a pie that is a full circle. `Número` draws it as what it is: one figure
 * per measure, labelled, side by side.
 *
 * Note this is now the only rule that keeps `kpi` out of anything: several
 * measures WITHOUT a grouping is a legitimate KPI block ("Número" renders one
 * figure each), so the old one-measure ceiling is gone from both halves.
 */
function ungroupedReason(option: PresentationOption, copy: PresentationCopy): string | null {
  if (option === 'kpi') return null;
  return option === 'table' ? copy.tableTakesAGrouping : copy.needsGrouping;
}

function reasonFor(
  option: PresentationOption,
  shape: SpecShape,
  copy: PresentationCopy,
): string | null {
  if (shape.dimensionCount === 0) return ungroupedReason(option, copy);
  if (option === 'kpi') return copy.kpiTakesNoGrouping;
  if (option === 'table') return null;
  return chartReason(option, shape, copy);
}

/** The full option list with per-option availability for a spec shape. */
export function presentationCompatibility(
  shape: SpecShape,
  copy: PresentationCopy,
): PresentationCompatibility[] {
  return PRESENTATION_OPTIONS.map((option) => ({
    option,
    disabledReason: reasonFor(option, shape, copy),
  }));
}

/** The two presentations for which stacking is even defined. */
const STACKABLE_OPTIONS: ReadonlySet<PresentationOption> = new Set(['bar', 'area']);

/**
 * Whether `Empilhado` does anything, and why not when it does not (FUT-755).
 *
 * Stacking is a statement about SERIES: bars sat on top of one another sum to
 * the whole, side by side they are compared. With one series there is nothing
 * to sit on and nothing to compare, so the toggle redraws an identical chart —
 * the same class of defect as a line over a categorical axis, a control that
 * claims to do something it cannot.
 *
 * Series come from the SPLIT when there is one (`pivot.ts` makes one series per
 * value), and from the MEASURES otherwise (`render.ts` builds one series per
 * measure). So either of those, in the plural, is what the toggle needs.
 *
 * `null` means the control does not apply at all — a pie has no stacking to
 * offer and should render no toggle, which is a different thing from a toggle
 * that is there and refused.
 */
export function stackedCompatibility(
  option: PresentationOption,
  shape: SpecShape,
  copy: PresentationCopy,
): PresentationCompatibility | null {
  if (!STACKABLE_OPTIONS.has(option)) return null;
  const hasSeveralSeries = shape.dimensionCount > 1 || shape.measureCount > 1;
  return { option, disabledReason: hasSeveralSeries ? null : copy.stackTakesTwoSeries };
}

/**
 * The smart default presentation for a shape: ANY ungrouped spec is a KPI tile,
 * an ORDERED axis charts as a line, any other grouping as bars, and only the
 * shape no chart can express (several measures ALONGSIDE a split) falls back to
 * a table. Always both matrix- and compiler-valid, which the suite checks shape
 * by shape.
 *
 * "Several measures without a grouping" used to be the other table case
 * (FUT-755). It is now a KPI with several figures — which is what the author
 * asked for by adding a second measure to a block that has no grouping to
 * spend it on.
 *
 * "Ordered" replaced "is a date" in FUT-755, so an hour-of-day or a weekday
 * axis now defaults to a line as well — "pedidos por hora" is the textbook
 * line chart and used to open as bars purely because the field is a string.
 *
 * A split is no longer a table either. It used to be — a two-dimension
 * breakdown could only be a table, because nothing pivoted the second
 * dimension into series — so an author who added a split while on a pie was
 * dropped all the way to a table when bars would now draw it.
 */
export function defaultPresentation(shape: SpecShape): ReportPresentation {
  if (shape.dimensionCount === 0) return { kind: 'kpi' };
  if (shape.dimensionCount > 1 && shape.measureCount !== 1) return { kind: 'table' };
  if (shape.firstDimensionIsOrdered) return { kind: 'chart', chartType: 'line' };
  return { kind: 'chart', chartType: 'bar' };
}
