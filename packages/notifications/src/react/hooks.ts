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
 * What a disabled badge reads, instead of whatever the store happens to hold.
 *
 * A CONSTANT, so `useSyncExternalStore`'s identity comparison sees no change
 * across the renders of a signed-out session.
 */
const NOTHING_TO_SHOW: InboxState = {
  unread: 0,
  items: [],
  status: 'idle',
  nextCursor: null,
  loadingMore: false,
};

/**
 * The badge's server state, kept fresh: pushed while a subscription is live,
 * polled otherwise.
 *
 * The whole state rather than the count, because every badge hook that layers
 * on top of it needs the poll and the subscription mounted exactly ONCE per
 * bell — read through two hooks, a bell that showed both a number and a tone
 * would open two of everything.
 *
 * ## `enabled` gates the ANSWER, not only the fetching
 *
 * It gates the poll and the subscription, which is the obvious half. It also
 * blanks the returned state, which is the half that was missing and matters
 * more: the store is per FACTORY and a host builds one at module scope for the
 * whole app, so signing out does not empty it — `refreshBadge` swallows the 401
 * and leaves the last number in place. Without this, a hook told there is
 * nobody signed in hands back the PREVIOUS reader's unread count and their
 * inbox rows.
 *
 * Deliberately here rather than at each caller. It was at each caller, three
 * times, in three shapes, and two of them were dead weight no test could reach
 * — which is what an invariant looks like just before one copy of it goes
 * missing.
 *
 * INTERNAL. Not exported from `./index`: it hands back rows as well as a count,
 * and a host wanting a number has `useUnreadCount` or the factory's
 * `useBellBadge`.
 */
export function useBadgeState(store: InboxStore, options: BadgeSyncOptions = {}): InboxState {
  const enabled = options.enabled ?? true;
  const subscribe = options.subscribe;
  const live = useInboxState(store);
  const state = enabled ? live : NOTHING_TO_SHOW;

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
  return useBadgeState(store, options).unread;
}

/** The panel's list — only fetches while the panel is open. */
export function useInboxList(store: InboxStore, open: boolean): InboxState {
  const state = useInboxState(store);
  useEffect(() => {
    if (open) store.open();
  }, [store, open]);
  return state;
}
