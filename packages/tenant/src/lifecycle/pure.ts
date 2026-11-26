/**
 * The lifecycle's pure readings: whether a status is gone, the typed-name
 * check, the purge date and the reminder due. No I/O, so a guard, a screen and
 * a test read the same answer.
 */
import type { TenantStatusSet } from '../config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether `status` is the closing or the closed status of the host's set. */
export function isTenantGone(statuses: Pick<TenantStatusSet, 'closing' | 'closed'>, status: string): boolean {
  return status === statuses.closing || status === statuses.closed;
}

/**
 * Two spellings of a tenant's name agree: Unicode composition, outer and
 * repeated spaces and case aside, case folded in `locale`. An empty typing
 * never agrees.
 */
export function sameTenantName(typed: string, name: string, locale: string): boolean {
  const norm = (value: string) =>
    value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase(locale);
  const left = norm(typed);
  return left !== '' && left === norm(name);
}

/**
 * When a tenant closed at `requestedAt` is purged: `graceDays` whole days of
 * 86 400 000 ms later. Milliseconds, never calendar days, so a daylight-saving
 * change moves nothing.
 */
export function purgeAtFor(requestedAt: Date, graceDays: number): Date {
  return new Date(requestedAt.getTime() + graceDays * DAY_MS);
}

/** Which reminder a sweep may send. */
export type TenantReminder = 'week' | 'day';

/**
 * The reminder due at `now` for a tenant purged at `purgeAt`, given the ones
 * already sent; null for none. `days.week` and `days.day` are how many days
 * before the purge each goes out. A sweep that missed the week (its queue was
 * down) sends the day's alone, and nothing is sent once the purge is due.
 */
export function reminderDue(
  purgeAt: Date,
  sent: { week: boolean; day: boolean },
  now: Date,
  days: { week: number; day: number },
): TenantReminder | null {
  const left = purgeAt.getTime() - now.getTime();
  if (left <= 0) return null;
  if (!sent.day && left <= days.day * DAY_MS) return 'day';
  if (!sent.week && !sent.day && left <= days.week * DAY_MS) return 'week';
  return null;
}
