/** One row or column of the heat map: a stable key and the words it reads. */
export interface HeatMapAxisItem {
  key: string;
  label: string;
}

/**
 * One cell. `value: null` is a cell that HAS an occurrence but no figure (a
 * ratio over a zero denominator, "no sale in that hour"): it reads
 * `labels.emptyValue` and is never tinted as above or below. A cell the caller
 * does not pass at all is BLANK — nothing happened there.
 */
export interface HeatMapCell {
  row: string;
  column: string;
  value: number | null;
}

/**
 * The diverging scale, in the values' own units. Above `target` is the
 * attention side; `strongAbove` and `strongBelow` pick the deeper tints.
 */
export interface HeatMapScale {
  target: number;
  /** Above this, the deeper attention tint. Defaults to no deeper step. */
  strongAbove?: number;
  /** Below this, the deeper calm tint. Defaults to no deeper step. */
  strongBelow?: number;
}

export type HeatMapTone = 'empty' | 'below-strong' | 'below' | 'above' | 'above-strong';

/** Every word the heat map draws or reads. The host's, in its language: nothing is defaulted. */
export interface HeatMapLabels {
  /** The attention side, e.g. "acima da meta". Legend, and read after each such cell. */
  above: string;
  /** The calm side, e.g. "abaixo da meta". Legend. */
  below: string;
  /** What a `null` cell means, e.g. "sem venda na hora". Legend, and read on such a cell. */
  empty: string;
  /** What a `null` cell shows. Defaults to an em dash. */
  emptyValue?: string;
}

export interface HeatMapProps {
  /** The row axis, top to bottom (e.g. weekdays). */
  rows: readonly HeatMapAxisItem[];
  /** The column axis, left to right (e.g. hours). */
  columns: readonly HeatMapAxisItem[];
  cells: readonly HeatMapCell[];
  scale: HeatMapScale;
  /** A cell's figure as text ("54%"); the component never formats numbers itself. */
  formatValue: (value: number) => string;
  labels: HeatMapLabels;
  /** The table's accessible name, visually hidden (the card's title is usually beside it). */
  caption?: string;
  /**
   * Swap rows and columns. `'auto'` (the default) transposes below the theme's
   * `md` breakpoint: seven weekday columns fit a phone where twenty-four hour
   * columns do not.
   */
  transpose?: boolean | 'auto';
  /** Draw the legend under the grid. Default true. */
  legend?: boolean;
  className?: string;
  dataTestId?: string;
}
