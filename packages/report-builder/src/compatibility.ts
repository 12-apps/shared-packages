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
  /** null = the compiler accepts this presentation; else a pt-BR reason. */
  disabledReason: string | null;
}

/**
 * Every reason names the CONTROL the author has to change, and quotes it
 * ("Tire o «agrupar por»"), rather than restating the rule that blocked them.
 * The register is `prototype.html`'s `vizBlocked`: the author is holding a
 * form, and the useful sentence is which field to touch next.
 */
const NEEDS_GROUPING = 'Um gráfico precisa de um agrupamento. Escolha um “agrupar por” ou use Tabela.';
const KPI_TAKES_NO_GROUPING =
  'Um número único não usa agrupamento. Tire o “agrupar por” para escolher.';
const KPI_TAKES_ONE_MEASURE =
  'Um número único mostra uma medida só. Deixe apenas uma medida para escolher.';
const ROUND_TAKES_NO_SPLIT =
  'Pizza e rosca mostram a composição de uma série só. Tire o “separar em séries” para escolher.';
const ROUND_TAKES_ONE_MEASURE =
  'Pizza e rosca mostram uma medida só. Deixe apenas uma medida para escolher.';
const SPLIT_TAKES_ONE_MEASURE =
  'Separar em séries já usa uma série por valor. Deixe apenas uma medida, ou tire o “separar em séries”.';
const LINE_NEEDS_ORDERED_AXIS =
  'Linha e área ligam um ponto ao outro, então o “agrupar por” precisa ter ordem — data, hora ou dia da semana. Troque o agrupamento ou use Barras.';

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
function unorderedAxisReason(option: PresentationOption, shape: SpecShape): string | null {
  const drawsSlopes = option === 'line' || option === 'area';
  return drawsSlopes && !shape.firstDimensionIsOrdered ? LINE_NEEDS_ORDERED_AXIS : null;
}

function chartReason(option: PresentationOption, shape: SpecShape): string | null {
  const isRound = option === 'pie' || option === 'donut';
  if (shape.dimensionCount === 0) return NEEDS_GROUPING;
  if (shape.dimensionCount > 1) {
    if (isRound) return ROUND_TAKES_NO_SPLIT;
    // A split already spends the series axis; a second measure would need a
    // third one. The compiler rejects it, so the picker must too.
    if (shape.measureCount !== 1) return SPLIT_TAKES_ONE_MEASURE;
    return unorderedAxisReason(option, shape);
  }
  if (isRound && shape.measureCount !== 1) return ROUND_TAKES_ONE_MEASURE;
  return unorderedAxisReason(option, shape);
}

function reasonFor(option: PresentationOption, shape: SpecShape): string | null {
  if (option === 'table') return null;
  if (option === 'kpi') {
    if (shape.dimensionCount !== 0) return KPI_TAKES_NO_GROUPING;
    if (shape.measureCount !== 1) return KPI_TAKES_ONE_MEASURE;
    return null;
  }
  return chartReason(option, shape);
}

/** The full option list with per-option availability for a spec shape. */
export function presentationCompatibility(shape: SpecShape): PresentationCompatibility[] {
  return PRESENTATION_OPTIONS.map((option) => ({
    option,
    disabledReason: reasonFor(option, shape),
  }));
}

/**
 * The smart default presentation for a shape: one ungrouped measure is a KPI
 * tile, an ORDERED axis charts as a line, any other grouping as bars, and only
 * the shapes no chart can express (several measures without a grouping, or
 * several measures ALONGSIDE a split) fall back to a table. Always both
 * matrix- and compiler-valid, which the suite checks shape by shape.
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
  if (shape.dimensionCount === 0) {
    return shape.measureCount === 1 ? { kind: 'kpi' } : { kind: 'table' };
  }
  if (shape.dimensionCount > 1 && shape.measureCount !== 1) return { kind: 'table' };
  if (shape.firstDimensionIsOrdered) return { kind: 'chart', chartType: 'line' };
  return { kind: 'chart', chartType: 'bar' };
}
