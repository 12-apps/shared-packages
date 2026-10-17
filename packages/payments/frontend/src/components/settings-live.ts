'use client';

import { useEffect, useRef } from 'react';

/**
 * The host's realtime channel for the settings screen (FUT-648).
 *
 * A provider's connection moves while nobody touches this tab: the OAuth grant
 * completes in the tab the owner sent to the provider, a colleague saves a key
 * or reorders the chain, a webhook or a sweep settles the activation charge.
 * The screen read its view once on mount and then sat on it, so all of that
 * reached the owner only through a reload.
 *
 * Nothing here knows what the channel is — the same split as the checkout's
 * `CheckoutLiveSignal`. A host that can hear "this store's payment settings
 * moved" passes whether its channel is live and a way to be told when it
 * fires; the screen re-reads its view on every hint and once each time the
 * channel (re)opens, because a hint published while it was down reached
 * nobody. The hint carries nothing and is never trusted as data: the re-read
 * goes through the same client, which is the only thing that decides what the
 * owner may see.
 *
 * There is no timer, live or not. The screen never polled, so a host without a
 * channel — or one whose channel is down — keeps exactly the mount read and its
 * own actions' re-reads, as before.
 */
export interface PaymentsSettingsLiveSignal {
  /** Whether the host's channel is connected right now. */
  live: boolean;
  /**
   * Be told when the channel says this store's payment settings moved.
   * Returns the unsubscribe. Should be stable across renders: a new function
   * re-subscribes.
   */
  subscribe: (onHint: () => void) => () => void;
}

/**
 * Re-read on every hint, and once whenever the channel goes from not-live to
 * live — the first connect after mount included, since the mount read may
 * have been answered before the subscription existed.
 *
 * `reload` is read through a ref so a host re-rendering with a new function
 * neither re-subscribes nor re-reads.
 */
export function useSettingsLive(
  signal: PaymentsSettingsLiveSignal | undefined,
  reload: () => void,
): void {
  const latest = useRef(reload);
  latest.current = reload;
  const live = signal?.live === true;
  const wasLive = useRef(live);
  const subscribe = signal?.subscribe;

  useEffect(() => {
    const opened = live && !wasLive.current;
    wasLive.current = live;
    if (opened) latest.current();
  }, [live]);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe(() => latest.current());
  }, [subscribe]);
}
