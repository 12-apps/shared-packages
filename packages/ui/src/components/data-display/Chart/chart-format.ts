import type { ChartNumberFormat } from './ChartSpec.types';

const formatters: Record<ChartNumberFormat, Intl.NumberFormat> = {
  brl: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
  percent: new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }),
  compact: new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }),
  integer: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }),
};

/**
 * Format a chart value with one of the serializable number formats.
 * `brl` expects integer centavos (repo-wide money convention); `percent`
 * expects a fraction (0.15 → "15%"). Non-finite values render as an empty
 * string so a null-ish row never draws "NaN" into a tooltip or axis.
 */
export function formatChartValue(value: number, format: ChartNumberFormat = 'decimal'): string {
  if (!Number.isFinite(value)) return '';
  if (format === 'brl') return formatters.brl.format(value / 100);
  return formatters[format].format(value);
}

/** Curried {@link formatChartValue}, memo-friendly for tooltip/axis props. */
export function chartValueFormatter(format?: ChartNumberFormat): (value: number) => string {
  return (value: number) => formatChartValue(value, format);
}
