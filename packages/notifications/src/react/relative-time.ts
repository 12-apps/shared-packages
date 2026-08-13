import type { NotificationMessages } from '../messages';

/**
 * "há 5 min"-style relative timestamp, falling back to an absolute date for
 * anything older than a week. Every word comes from the messages table, so a
 * host in another locale changes the copy and the locale together.
 */
export function relativeTime(iso: string, messages: NotificationMessages): string {
  const elapsedMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return messages.justNow;
  if (minutes < 60) return messages.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return messages.hoursAgo(hours);
  const days = Math.round(hours / 24);
  if (days < 7) return messages.daysAgo(days);
  return new Date(iso).toLocaleDateString(messages.dateLocale);
}
