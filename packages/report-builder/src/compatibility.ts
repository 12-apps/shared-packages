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

/** Every presentation an author can pick, flattened (table, KPI, chart types). */
export const PRESENTATION_OPTIONS = ['table', 'kpi', 'line', 'bar', 'area', 'pie', 'donut'] as const;
export type PresentationOption = (typeof PRESENTATION_OPTIONS)[number];

export interface PresentationCompatibility {
  option: PresentationOption;
  /** null = the compiler accepts this presentation; else a pt-BR reason. */
  disabledReason: string | null;
}

function reasonFor(option: PresentationOption, shape: SpecShape): string | null {
  if (option === 'table') return null;
  if (option === 'kpi') {
    if (shape.dimensionCount !== 0) return 'KPI resume o período inteiro — remova os agrupamentos.';
    if (shape.measureCount !== 1) return 'KPI exige exatamente 1 medida.';
    return null;
  }
  if (shape.dimensionCount !== 1) {
    return 'Gráficos exigem exatamente 1 agrupamento — use Tabela.';
  }
  if ((option === 'pie' || option === 'donut') && shape.measureCount !== 1) {
    return 'Pizza/rosca exigem exatamente 1 medida.';
  }
  return null;
}

/** The full option list with per-option availability for a spec shape. */
export function presentationCompatibility(shape: SpecShape): PresentationCompatibility[] {
  return PRESENTATION_OPTIONS.map((option) => ({
    option,
    disabledReason: reasonFor(option, shape),
  }));
}

/**
 * The smart default presentation for a shape: one ungrouped measure is a
 * KPI tile, a time series charts as a line, a single categorical grouping
 * as bars, anything else (multi-measure without grouping, or a
 * two-dimension breakdown) as a table. Always compiler-valid.
 */
export function defaultPresentation(shape: SpecShape): ReportPresentation {
  if (shape.dimensionCount === 0 && shape.measureCount === 1) return { kind: 'kpi' };
  if (shape.dimensionCount !== 1) return { kind: 'table' };
  if (shape.firstDimensionIsDate) return { kind: 'chart', chartType: 'line' };
  return { kind: 'chart', chartType: 'bar' };
}
