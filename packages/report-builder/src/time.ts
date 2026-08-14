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

/*
 * `DEFAULT_REPORT_TIME_ZONE = 'America/Sao_Paulo'` used to live here, and was
 * the last rung of compile's zone chain: a caller that named no zone got a
 * Brazilian trading day. It is gone. Omitting `timeZone` means UTC — the
 * absence of a guess — and the mounted surface never reaches that rung, because
 * `ReportBuilderServerConfig.timeZone` is required.
 */

interface CivilDate {
  year: number;
  month: number;
  day: number;
  /** Local hour, 0-23. Only the business-day offset reads it. */
  hour: number;
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
    hour: '2-digit',
    // `hourCycle: 'h23'` and not `hour12: false`: the latter renders midnight
    // as 24 on some runtimes, which would push every 00:00 event a day early.
    hourCycle: 'h23',
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
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
    };
  }
  const parts = civilFormatter(timeZone).formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') };
}

/**
 * Truncate an instant to the start of its `grain` bucket on `timeZone`'s
 * calendar (default: UTC). Weeks are ISO weeks — Monday start.
 *
 * `dayStartsAt` (0-23, default 0) moves the boundary off midnight for a store
 * whose trading day does not end there (FUT-755). A bar closing at 02:00 wants
 * Tuesday's takings to include Wednesday 00:00-02:00; with the civil day as the
 * only day, that revenue lands on Wednesday and both days read wrong — one
 * short, the next inexplicably busy before opening. An hour BEFORE the boundary
 * belongs to the previous day, at every grain: a 01:00 sale on the 1st of the
 * month is last month's if the day starts at 05:00, which is exactly the answer
 * the owner expects when they reconcile the till.
 */
export function truncateDateToGrain(
  value: string | number | Date,
  grain: TimeGrain,
  timeZone?: string,
  dayStartsAt = 0,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Cannot bucket invalid date value: ${String(value)}`);
  }
  if (!Number.isInteger(dayStartsAt) || dayStartsAt < 0 || dayStartsAt > 23) {
    throw new Error(`"dayStartsAt" must be a whole hour 0-23, got ${String(dayStartsAt)}.`);
  }
  const civil = civilDateIn(date, timeZone);
  // A UTC Date standing in for the local CIVIL date: calendar arithmetic on
  // it is DST-free, and only the Y/M/D of the result is ever read.
  const bucket = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  // Before the boundary is still yesterday's trading day. Done here, before the
  // month/week truncation below, so the shift can carry across a month or ISO
  // week edge rather than being clamped inside the civil one.
  if (civil.hour < dayStartsAt) bucket.setUTCDate(bucket.getUTCDate() - 1);
  if (grain === 'month') bucket.setUTCDate(1);
  if (grain === 'week') {
    // ISO week: Monday start. getUTCDay(): 0 = Sunday.
    const weekday = (bucket.getUTCDay() + 6) % 7;
    bucket.setUTCDate(bucket.getUTCDate() - weekday);
  }
  return bucket.toISOString().slice(0, 10);
}
