import type { ChartNumberFormat } from '@12-apps/ui/charts';

import { formatKpiFigure } from '../format';

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

/** 1, 2, 5 times a power of ten: the step a reader can count in. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** A value axis that always contains zero and ends on round numbers. */
export function niceScale(lowest: number, highest: number, target = 4): Scale {
  const min = Math.min(0, lowest);
  const max = Math.max(0, highest);
  if (min === max) return { min: 0, max: 1, ticks: [0, 1] };
  const step = niceStep((max - min) / target);
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const count = Math.round((last - first) / step);
  const ticks = Array.from({ length: count + 1 }, (_, index) => Number((first + index * step).toPrecision(12)));
  return { min: first, max: last, ticks };
}

const COMPACT_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** An axis tick as short text; money is read in whole reais and compacted. */
export function tickText(value: number, format: ChartNumberFormat | undefined): string {
  if (format === 'brl') return COMPACT_BRL.format(value / 100);
  if (format === 'percent') return formatKpiFigure(value, 'percent');
  if (format === 'integer') return formatKpiFigure(value, 'integer');
  return formatKpiFigure(value, 'compact');
}
