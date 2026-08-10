/**
 * Presentation compatibility matrix + smart defaults (FUT-308) — the
 * compiler's chart-shape rules (`assertChartShape`) expressed as DATA, so
 * authoring surfaces (builder UI, MCP docs) can offer only what the compiler
 * accepts instead of round-tripping a 400. A dedicated test proves this
 * matrix and the compiler agree on every shape — change one, the test forces
 * the other.
 */
import type { ReportPresentation } from './spec';

/** The shape facts the chart rules depend on. */
export interface SpecShape {
  dimensionCount: number;
  measureCount: number;
  /** Whether the (single) grouping dimension is a date field. */
  firstDimensionIsDate: boolean;
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

function chartReason(option: PresentationOption, shape: SpecShape): string | null {
  const isRound = option === 'pie' || option === 'donut';
  if (shape.dimensionCount === 0) return NEEDS_GROUPING;
  if (shape.dimensionCount > 1) {
    if (isRound) return ROUND_TAKES_NO_SPLIT;
    // A split already spends the series axis; a second measure would need a
    // third one. The compiler rejects it, so the picker must too.
    return shape.measureCount === 1 ? null : SPLIT_TAKES_ONE_MEASURE;
  }
  if (isRound && shape.measureCount !== 1) return ROUND_TAKES_ONE_MEASURE;
  return null;
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
 * tile, a time axis charts as a line, any other grouping as bars, and only the
 * shapes no chart can express (several measures without a grouping, or several
 * measures ALONGSIDE a split) fall back to a table. Always compiler-valid.
 *
 * A split is no longer among them (FUT-755). It used to be — a two-dimension
 * breakdown could only be a table, because nothing pivoted the second
 * dimension into series — so an author who added a split while on a pie was
 * dropped all the way to a table when bars would now draw it.
 */
export function defaultPresentation(shape: SpecShape): ReportPresentation {
  if (shape.dimensionCount === 0) {
    return shape.measureCount === 1 ? { kind: 'kpi' } : { kind: 'table' };
  }
  if (shape.dimensionCount > 1 && shape.measureCount !== 1) return { kind: 'table' };
  if (shape.firstDimensionIsDate) return { kind: 'chart', chartType: 'line' };
  return { kind: 'chart', chartType: 'bar' };
}
