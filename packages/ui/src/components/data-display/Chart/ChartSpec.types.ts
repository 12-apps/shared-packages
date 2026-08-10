import type { ColorValue } from '../../../tokens/scales';
/**
 * JSON-serializable chart specification — the declarative surface of the raw
 * chart library. A `ChartSpec` plus plain data rows fully describes a rendered
 * chart, so specs can be persisted, transmitted and authored by report
 * builders or LLMs without touching component code. Colors are semantic theme
 * tokens (never raw hex) so light/dark rendering stays correct.
 */

/** Built-in chart types. New types can be added via the renderer registry. */
export type ChartSpecType = 'line' | 'bar' | 'area' | 'pie' | 'donut';

/**
 * Semantic color token resolved against the MUI palette at render time.
 * Specs must not carry raw color values.
 */
/**
 * The house vocabulary minus `neutral`: a data series is always an accent, and
 * an unaccented series would be indistinguishable from the grid it sits on.
 */
export type ChartSemanticColor = ColorValue;

/**
 * Number formatting applied to tooltip values and the y axis.
 * `brl` treats values as integer centavos (the repo-wide money convention)
 * and renders them as reais, e.g. `123456` → `R$ 1.234,56`.
 * `percent` treats values as fractions, e.g. `0.153` → `15,3%`.
 */
export type ChartNumberFormat = 'brl' | 'percent' | 'compact' | 'integer' | 'decimal';

export interface ChartSpecSeries {
  /** Row property holding this series' value. */
  key: string;
  /** Legend/tooltip label; defaults to `key`. */
  label?: string;
  /** Semantic color token; defaults to cycling the spec's color scheme. */
  color?: ChartSemanticColor;
}

export interface ChartSpecAxis {
  /** Row property plotted on the category (x) axis — for pie/donut, the slice name. */
  key: string;
  label?: string;
}

export interface ChartSpec {
  type: ChartSpecType;
  title?: string;
  subtitle?: string;
  xAxis: ChartSpecAxis;
  yAxis?: { label?: string };
  /** At least one series. Pie/donut charts read slice values from the first series. */
  series: ChartSpecSeries[];
  /** Stack cartesian series instead of grouping them side by side. */
  stacked?: boolean;
  /** Show the legend (default true). */
  legend?: boolean;
  /** Show the tooltip (default true). */
  tooltip?: boolean;
  numberFormat?: ChartNumberFormat;
  /** Palette cycled across series without an explicit color. */
  colorScheme?: ChartSemanticColor[];
  /** Smooth (monotone) lines/areas (default true). */
  curved?: boolean;
  /** Chart height in px; defaults to the host component's size. */
  height?: number;
  /** Center label rendered inside a donut chart. */
  centerLabel?: string | { label: string; value: string | number };
}
