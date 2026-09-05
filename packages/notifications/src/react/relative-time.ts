import type { NotificationMessages } from '../messages';

/**
 * "há 5 min"-style relative timestamp, falling back to an absolute date for
 * anything older than a week. Every word comes from the messages table, so a
 * host in another locale changes the copy and the locale together.
 *
 * `now` is a parameter rather than a read, and the live section is why. A
 * relative phrase is only true for the instant it was computed, so something
 * has to CAUSE the render that recomputes it — and the live entries' own data
 * cannot: a host backed by react-query gets the previous object back whenever a
 * poll is deep-equal (`structuralSharing`, on by default), which within one
 * stage it always is. The section therefore ticks a clock and hands it down.
 * Defaulted, so every existing caller reads the wall clock exactly as before.
 */
export function relativeTime(
  iso: string,
  messages: NotificationMessages,
  now: number = Date.now(),
): string {
  const elapsedMs = now - new Date(iso).getTime();
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return messages.justNow;
  if (minutes < 60) return messages.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return messages.hoursAgo(hours);
  const days = Math.round(hours / 24);
  if (days < 7) return messages.daysAgo(days);
  return new Date(iso).toLocaleDateString(messages.dateLocale);
}
