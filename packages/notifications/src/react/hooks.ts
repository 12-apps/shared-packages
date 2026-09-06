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

/**
 * The same wiring, as a HOOK — for a host whose realtime connection lives in
 * React context rather than in a module.
 *
 * `subscribe` above is supplied at FACTORY time, which is module scope, and a
 * context-bound connection cannot be reached from there: the provider holding
 * it is inside the tree. A host in that shape (a `<UserRealtimeProvider>` and a
 * `useUserTopics` hook, which is the common one) had no way to pass anything at
 * all, and the badge simply never heard an event.
 *
 * So this is the second door, and it is the one `@12-apps/app-shell` already
 * uses for the same problem — its consent dialog takes a `useSignal` hook for
 * exactly this reason. Two packages solving one problem two ways is how an
 * adopter ends up believing the feature is unavailable to it.
 *
 * Called during render, so it may use context and hooks freely. Pass one or
 * the other; passing both runs both, which is a host's business.
 */
export type NotificationsSignalHook = (onHint: () => void) => void;

export function useInboxState(store: InboxStore): InboxState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** What both badge hooks below take, and what the bell passes them. */
export interface BadgeSyncOptions {
  enabled?: boolean;
  subscribe?: NotificationsSubscribe;
  useSignal?: NotificationsSignalHook;
}

/**
 * The badge's server state, kept fresh: pushed while a subscription is live,
 * polled otherwise.
 *
 * `enabled` gates the poll AND the subscription. A signed-out header still
 * mounts the bell, and there is nothing for it to hear.
 *
 * The whole state rather than the count, because a bell that shows live
 * activities needs the live-subject breakdown alongside it — see
 * `bell-badge.ts`. The two must come from ONE hook: read through two, the poll
 * and the subscription would be mounted twice per bell.
 */
export function useBadgeState(store: InboxStore, options: BadgeSyncOptions = {}): InboxState {
  const enabled = options.enabled ?? true;
  const subscribe = options.subscribe;
  const state = useInboxState(store);

  // Called unconditionally — it is a hook, so it cannot sit behind `enabled`.
  // The host's own hook decides what to do when there is nothing to hear.
  options.useSignal?.(() => {
    if (enabled) store.invalidate();
  });

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

  return state;
}

/**
 * The bell badge number, for a host with its own trigger chrome.
 *
 * A host that also publishes live activities wants `useBellBadge` from the
 * factory instead — this one counts inbox rows and knows nothing about what is
 * happening right now.
 */
export function useUnreadCount(store: InboxStore, options: BadgeSyncOptions = {}): number {
  const { unread } = useBadgeState(store, options);
  return (options.enabled ?? true) ? unread : 0;
}

/** The panel's list — only fetches while the panel is open. */
export function useInboxList(store: InboxStore, open: boolean): InboxState {
  const state = useInboxState(store);
  useEffect(() => {
    if (open) store.open();
  }, [store, open]);
  return state;
}
