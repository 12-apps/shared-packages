import type { TimeGrain } from './types';

/**
 * Date-bucket truncation shared by every executor.
 *
 * Buckets are computed on the TENANT's clock (FUT-454): a sale rung up at
 * 2026-07-31T02:00Z belongs to the 30th of July for a São Paulo merchant, and
 * a "yesterday vs today" report that says otherwise is simply wrong. The
 * conversion is pure JS (`Intl`), NOT SQL — the pipeline fetches rows and
 * folds them in process, so the same buckets come out on PostgreSQL, on
 * PGlite, and in the in-memory reference executor with no dialect to match.
 *
 * The bucket start is returned as a `YYYY-MM-DD` string so labels stay
 * serializable and sortable. Omitting `timeZone` keeps the original UTC
 * behaviour, which is what the naked helper has always documented.
 */

/** The tenant zone assumed when neither the spec nor the host names one. */
export const DEFAULT_REPORT_TIME_ZONE = 'America/Sao_Paulo';

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

/** Whether a string names a zone this runtime's IANA database knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    civilFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function civilDateIn(date: Date, timeZone: string | undefined): CivilDate {
  if (!timeZone) {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  const parts = civilFormatter(timeZone).formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return { year: read('year'), month: read('month'), day: read('day') };
}

/**
 * Truncate an instant to the start of its `grain` bucket on `timeZone`'s
 * calendar (default: UTC). Weeks are ISO weeks — Monday start.
 */
export function truncateDateToGrain(
  value: string | number | Date,
  grain: TimeGrain,
  timeZone?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Cannot bucket invalid date value: ${String(value)}`);
  }
  const civil = civilDateIn(date, timeZone);
  // A UTC Date standing in for the local CIVIL date: calendar arithmetic on
  // it is DST-free, and only the Y/M/D of the result is ever read.
  const bucket = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  if (grain === 'month') bucket.setUTCDate(1);
  if (grain === 'week') {
    // ISO week: Monday start. getUTCDay(): 0 = Sunday.
    const weekday = (bucket.getUTCDay() + 6) % 7;
    bucket.setUTCDate(bucket.getUTCDate() - weekday);
  }
  return bucket.toISOString().slice(0, 10);
}
