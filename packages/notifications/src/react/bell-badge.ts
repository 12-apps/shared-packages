/**
 * What the bell shows: ONE number, and whether any of it is news.
 *
 * The badge answers two different questions with one glyph, and keeping them
 * apart is the whole design:
 *
 * - the COUNT is how many things the centre is holding for the reader;
 * - the TONE is whether any of them has happened since they last looked.
 *
 * An inbox row makes those the same question — an unread row is by definition
 * both present and unseen — which is why the distinction did not exist before
 * live activities did. A live activity separates them: a pedido that has been
 * `Preparo` for ten minutes is still worth a `1`, and shouting about it every
 * render is how a badge teaches people to stop reading it.
 *
 * ## One thing happening is counted once
 *
 * A live pedido also writes inbox rows as it moves — "Seu pedido está pronto"
 * is a notification, and it is still there tomorrow when the pedido is not. So
 * while the subject is on screen its unread rows are NOT added again: the live
 * entry is the same news, said better and in the place the reader is looking.
 * They start counting the moment it finishes and the pinned entry goes away,
 * which is exactly when they become the only record of it.
 *
 * That subtraction is possible because the server sends the breakdown next to
 * the count (`UnreadSummary`) and the host publishes what is live. Neither half
 * can do it alone, and this is the one place they meet.
 */
import { useSyncExternalStore } from 'react';

import type { LiveActivity } from '../live';

import { useBadgeState, type BadgeSyncOptions } from './hooks';
import type { InboxStore } from './inbox-state';
import type { LiveActivitiesConfig } from './live-config';
import { hasUnseenActivity, type LiveSeenStore } from './live-seen';

/** The bell's whole state — see the file docblock for what each half means. */
export interface BellBadge {
  /** What the badge shows. `0` renders no badge at all. */
  count: number;
  /**
   * Whether any of it has arrived or moved since the reader last looked.
   *
   * The trigger paints this as its accent colour; a host with its own chrome
   * decides how to say it, but it should be a difference somebody notices.
   */
  hasNew: boolean;
}

/**
 * The badge for a host with no live activities: unread rows, and that is all.
 *
 * `hasNew` is `count > 0` here, and not as a simplification — an UNREAD row is
 * one the reader has not seen, so for this host presence and novelty really are
 * the same fact.
 */
export function useInboxBellBadge(store: InboxStore, options: BadgeSyncOptions = {}): BellBadge {
  const { unread } = useBadgeState(store, options);
  const count = (options.enabled ?? true) ? unread : 0;
  return { count, hasNew: count > 0 };
}

/**
 * The badge for a host that configured live activities.
 *
 * A SECOND hook rather than a flag on the one above, for the reason the bell
 * itself is two components: `live.useActivities` is a hook, so a single hook
 * reading an optional config would be calling one conditionally — which React
 * reports as a crash somewhere else entirely. The factory knows statically
 * which host it is building for and binds one.
 *
 * ## What it costs the host, stated plainly
 *
 * The bell is mounted for as long as the app is, so unlike the panel's copy of
 * this hook there is no "nobody is looking" state to stand down in — `active`
 * is simply `enabled`. A host that answers by polling therefore polls for every
 * signed-in reader whether or not they ever open the centre. That is the price
 * of a badge that knows about live activities at all, and the reason to answer
 * this hook from a pushed cache rather than from an interval.
 */
export function useLiveBellBadge(
  store: InboxStore,
  live: LiveActivitiesConfig,
  seen: LiveSeenStore,
  options: BadgeSyncOptions = {},
): BellBadge {
  const enabled = options.enabled ?? true;
  const { unread, unreadLiveSubjects } = useBadgeState(store, options);
  const activities = live.useActivities({ active: enabled });
  const seenAt = useSyncExternalStore(seen.subscribe, seen.read, seen.read);
  if (!enabled) return { count: 0, hasNew: false };
  const rows = Math.max(0, unread - pinnedUnread(activities, unreadLiveSubjects));
  return {
    count: rows + activities.length,
    hasNew: rows > 0 || hasUnseenActivity(activities, seenAt),
  };
}

/**
 * How many unread rows are about something already pinned above the list.
 *
 * Clamped at zero per subject rather than trusted: the breakdown is a bounded
 * scan of the newest unread rows and the optimistic path edits it locally, so a
 * negative here would mean subtracting rows that were never counted.
 */
function pinnedUnread(
  activities: readonly LiveActivity[],
  unreadLiveSubjects: Readonly<Record<string, number>>,
): number {
  let pinned = 0;
  for (const activity of activities) {
    pinned += Math.max(0, unreadLiveSubjects[activity.id] ?? 0);
  }
  return pinned;
}
