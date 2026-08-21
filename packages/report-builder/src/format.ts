import type { ValueFormatCopy } from './copy';
import { isSuppressed, type ReportCellValue, type ReportKpiFormat, type ReportValueFormat } from './types';

/**
 * The ONE place a report value becomes text (FUT-454). Dashboard cells, KPI
 * tiles and the CSV/JSON export all call through here, so the screen and the
 * downloaded file can never disagree — and a suppressed cell renders as the
 * same em-dash as a missing one, which is the point: a reader must not be able
 * to tell "hidden" from "absent".
 *
 * Framework-free (no React, no Intl locale negotiation beyond pt-BR) so the
 * server can format for API metadata and the SPA for the screen.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
/** 0-1 ratio in, "84%" / "84,4%" out — one decimal only where it says something. */
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** What a null, non-finite or SUPPRESSED value renders as, everywhere. */
export const SUPPRESSED_PLACEHOLDER = '—';

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * Seconds → "1h 23m" / "12m 30s" / "45s". Trailing zero units are dropped
 * (3600 → "1h", not "1h 0m") and the largest two units always win: an
 * operations reader wants the magnitude, not the remainder.
 */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return SUPPRESSED_PLACEHOLDER;
  const total = Math.round(Math.abs(seconds));
  const sign = seconds < 0 ? '-' : '';
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = total % SECONDS_PER_MINUTE;
  if (hours > 0) return `${sign}${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  if (minutes > 0) return `${sign}${minutes}m${rest > 0 ? ` ${rest}s` : ''}`;
  return `${sign}${rest}s`;
}

/** A finite number rendered with one of the value formats. */
function formatNumber(value: number, format: ReportValueFormat | 'compact'): string {
  if (!Number.isFinite(value)) return SUPPRESSED_PLACEHOLDER;
  switch (format) {
    case 'brl':
      // Repo-wide money convention: integer centavos on the wire.
      return BRL.format(value / 100);
    case 'integer':
      return INTEGER.format(value);
    case 'percent':
      return PERCENT.format(value);
    case 'duration':
      return formatDurationSeconds(value);
    case 'compact':
      return COMPACT.format(value);
    default:
      return DECIMAL.format(value);
  }
}

/** Format one result cell for display or export. */
export function formatReportValue(
  value: ReportCellValue | undefined,
  format: ReportValueFormat,
  copy: ValueFormatCopy,
): string {
  if (value === null || value === undefined || isSuppressed(value)) return SUPPRESSED_PLACEHOLDER;
  if (typeof value === 'boolean') return value ? copy.booleanTrue : copy.booleanFalse;
  if (typeof value === 'number') return formatNumber(value, format);
  return value;
}

/** Format a KPI tile's figure; `null` (including a suppressed one) is the em-dash. */
export function formatKpiFigure(value: number | null, format: ReportKpiFormat): string {
  if (value === null) return SUPPRESSED_PLACEHOLDER;
  return formatNumber(value, format);
}
