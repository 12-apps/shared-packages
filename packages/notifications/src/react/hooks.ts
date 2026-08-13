import { useEffect, useSyncExternalStore } from 'react';

import {
  BADGE_POLL_MS,
  BADGE_RECONCILE_MS,
  type InboxState,
  type InboxStore,
} from './inbox-state';

/**
 * The two hooks the bell and the panel use, and the realtime seam between them.
 *
 * A host that has a message bus passes `subscribe`; one that has not passes
 * nothing and keeps the 60 s poll. The bell ships in this package and mounts in
 * whatever embeds it, so it must not require the host to have adopted anything.
 */

/**
 * How the surface learns an inbox changed without asking.
 *
 * Called once per mounted bell with a callback that means only "ask again" — no
 * payload, so the number on screen is always one the server just gave us.
 * Returns its own teardown. A host wires this to whatever it already has.
 */
export type NotificationsSubscribe = (onHint: () => void) => () => void;

export function useInboxState(store: InboxStore): InboxState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * The bell badge number: pushed while a subscription is live, polled otherwise.
 *
 * `enabled` gates the poll AND the subscription. A signed-out header still
 * mounts the bell, and there is nothing for it to hear.
 */
export function useUnreadCount(
  store: InboxStore,
  options: { enabled?: boolean; subscribe?: NotificationsSubscribe } = {},
): number {
  const enabled = options.enabled ?? true;
  const subscribe = options.subscribe;
  const { unread } = useInboxState(store);

  useEffect(() => {
    if (!enabled) return;
    store.refreshBadge();
    const unsubscribe = subscribe?.(() => store.invalidate());
    // A live subscription relaxes the poll to the reconcile interval; without
    // one it stays the 60 s poll.
    const interval = setInterval(
      () => store.refreshBadge(),
      subscribe ? BADGE_RECONCILE_MS : BADGE_POLL_MS,
    );
    const onFocus = (): void => store.refreshBadge();
    globalThis.addEventListener?.('focus', onFocus);
    return () => {
      clearInterval(interval);
      globalThis.removeEventListener?.('focus', onFocus);
      unsubscribe?.();
    };
  }, [store, enabled, subscribe]);

  return enabled ? unread : 0;
}

/** The panel's list — only fetches while the panel is open. */
export function useInboxList(store: InboxStore, open: boolean): InboxState {
  const state = useInboxState(store);
  useEffect(() => {
    if (open) store.open();
  }, [store, open]);
  return state;
}
