import type { AccountStateRow, DeletionMailKind } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an account whose deletion was asked at `requestedAt` is purged. */
export function purgeDateOf(requestedAt: Date, graceDays: number): Date {
  return new Date(requestedAt.getTime() + graceDays * DAY_MS);
}

/**
 * The reminder owed now, if any: 7 days before the purge, then 1 day before
 * (each once, by its stamp). A window shorter than a reminder's lead sends
 * only the reminders that still lie ahead of scheduling.
 */
export function dueReminder(row: AccountStateRow, now: Date): Exclude<DeletionMailKind, "scheduled" | "cancelled"> | null {
  if (!row.requestedAt || !row.purgeAt || row.deletedAt) return null;
  const left = row.purgeAt.getTime() - now.getTime();
  if (left <= 0) return null;
  const lead = row.purgeAt.getTime() - row.requestedAt.getTime();
  if (left <= DAY_MS && !row.remindedDayAt && lead > DAY_MS) return "day-before";
  if (left <= 7 * DAY_MS && left > DAY_MS && !row.remindedWeekAt && lead > 7 * DAY_MS) return "week-before";
  return null;
}

/** Whether the purge is owed now. */
export function purgeDue(row: AccountStateRow, now: Date): boolean {
  return Boolean(row.requestedAt && row.purgeAt && !row.deletedAt && row.purgeAt.getTime() <= now.getTime());
}

/** Whether the `at` sign-in claim is recent enough to stand in for the password. */
export function isFreshSignIn(at: string | null | undefined, now: number, windowMs: number): boolean {
  const signedInAt = Number(at);
  if (!Number.isFinite(signedInAt) || signedInAt <= 0) return false;
  return now - signedInAt >= 0 && now - signedInAt <= windowMs;
}
