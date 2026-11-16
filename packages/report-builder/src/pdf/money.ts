import type { ValueFormatCopy } from '../copy';
import { formatKpiFigure, formatReportValue } from '../format';
import type { ReportCellValue, ReportKpiFormat, ReportValueFormat } from '../types';

const BRL_WHOLE = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Money the way the screen shows it, in whole reais ("R$ 9.680"), unless the measure declares its cents. */
function wholeReais(value: unknown, format: ReportValueFormat | ReportKpiFormat, decimals?: number): string | null {
  if (format !== 'brl' || decimals !== undefined || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return BRL_WHOLE.format(value / 100);
}

/** A tile's figure. */
export function pdfFigure(value: number | null, format: ReportKpiFormat, decimals?: number): string {
  return wholeReais(value, format, decimals) ?? formatKpiFigure(value, format, decimals);
}

/** A table or grid cell's figure. */
export function pdfValue(
  value: ReportCellValue | undefined,
  format: ReportValueFormat,
  copy: ValueFormatCopy,
  decimals?: number,
): string {
  return wholeReais(value, format, decimals) ?? formatReportValue(value ?? null, format, copy, decimals);
}
