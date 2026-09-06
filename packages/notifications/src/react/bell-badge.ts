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
 * ## This is here so a host can DRAW it
 *
 * The numbers were already correct inside this package's own `BellButton`, and
 * unreachable from a host that cannot take that component — a header whose cart
 * and search buttons are one styled icon-button is importing a second trigger
 * style the moment it does. Such a host had `useUnreadCount` and nothing else,
 * so its bell showed NOTHING while a pinned pedido sat inside the panel it
 * opens. Both bells now read these hooks, so a host cannot drift from what this
 * package renders.
 *
 * ## What it does NOT yet do
 *
 * A live subject usually also writes inbox rows as it moves, and this counts
 * both: a pedido with one unread row about it reads `2`. Answering that needs
 * the server to say which unread rows name which subject, and the query that
 * would do it has no index behind it — `notifications.prisma` carries
 * `[userId, deletedAt, readAt]` and `[userId, deletedAt, createdAt]`, neither of
 * which serves the ordered scan over unread rows. So it is a schema change with
 * a migration rather than a line of arithmetic, and it is deliberately not this
 * one: shipping the arithmetic first would put an unindexed read on the badge
 * poll, which runs every 60 s per open tab.
 */
import { useSyncExternalStore } from 'react';

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
 * ## `enabled` is enforced HERE, not taken on trust
 *
 * A host is explicitly allowed to ignore the `active` hint and always answer
 * (`./live-config`), and at least one real adopter does. So a signed-out header
 * — which still MOUNTS the bell — can be handed a list of somebody's pedidos,
 * and the guard below is the only thing between that and a badge counting them.
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
  const { unread } = useBadgeState(store, options);
  const activities = live.useActivities({ active: enabled });
  const seenAt = useSyncExternalStore(seen.subscribe, seen.read, seen.read);
  if (!enabled) return { count: 0, hasNew: false };
  return {
    // A live entry counts. It is a notification — it is the one the reader most
    // wants to know about — and the panel it opens lists it.
    count: unread + activities.length,
    hasNew: unread > 0 || hasUnseenActivity(activities, seenAt),
  };
}
