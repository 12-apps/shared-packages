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

/** Whole reais, for an axis tick that has no centavos to show. */
const brlWhole = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a value-AXIS tick: {@link formatChartValue}, except that a `brl` tick
 * on a whole real drops its ",00".
 *
 * An axis tick is a gridline's name, not an amount anybody reads to the
 * centavo. Recharts picks round ticks (R$ 45, R$ 90, R$ 135…), so on a phone
 * "R$ 180,00" spent a fifth of the card on two zeros and squeezed the plot it
 * labels to ~160px at 390. A tick that does fall between reais keeps its
 * centavos, so no tick is ever rounded into a value it is not. Tooltips keep
 * the full amount: they ARE read to the centavo.
 */
export function formatChartAxisValue(value: number, format: ChartNumberFormat = 'decimal'): string {
  if (format === 'brl' && Number.isFinite(value) && value % 100 === 0) {
    return brlWhole.format(value / 100);
  }
  return formatChartValue(value, format);
}

/** Curried {@link formatChartAxisValue}, memo-friendly for the value axis. */
export function chartAxisValueFormatter(format?: ChartNumberFormat): (value: number) => string {
  return (value: number) => formatChartAxisValue(value, format);
}
