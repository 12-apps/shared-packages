// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotificationsApiClient } from '../api';
import type { NotificationsResult, NotificationsTransport } from '../transport';
import { useUnreadCount } from '../hooks';
import { BADGE_POLL_MS, BADGE_RECONCILE_MS, createInboxStore } from '../inbox-state';

/**
 * How often the badge asks for its count, and what stops it.
 *
 * The fallback rule (FUT-437): while the host says its channel is live the
 * badge keeps NO timer — it hears its hint, re-reads on focus and on every
 * (re)open of the channel — and while the channel is down it asks every
 * minute. `live` is the host's own word for a channel this package does not
 * hold. A factory-time `subscribe` with no `live` beside it cannot say whether
 * it is up, so it keeps the five-minute reconcile it always had.
 */

const UNREAD_PATH = '/api/account/notifications/unread-count';
const API_BASE = '/api/account';

/** A transport whose every read is recorded; the count is always zero. */
function recordingTransport() {
  const get = vi.fn((path: string) =>
    Promise.resolve(path === UNREAD_PATH ? { count: 0 } : { items: [], nextCursor: null }),
  );
  const transport: NotificationsTransport = {
    get: <T,>(path: string): Promise<T> => get(path) as Promise<T>,
    send: <T,>(): Promise<NotificationsResult<T>> =>
      Promise.resolve({ ok: true, data: {} as T }),
  };
  return { transport, get };
}

/**
 * The badge, mounted on a store of its own, and the two things a case does
 * with it: count the reads it made, and tell it the channel dropped.
 */
function mountBadge(options: { live?: boolean; enabled?: boolean }) {
  const { transport, get } = recordingTransport();
  const store = createInboxStore(createNotificationsApiClient(API_BASE, transport));
  const { rerender } = renderHook(
    (props: { live?: boolean; enabled?: boolean }) => useUnreadCount(store, props),
    { initialProps: options },
  );
  return {
    reads: (): number => get.mock.calls.filter(([path]) => path === UNREAD_PATH).length,
    dropChannel: (): void => rerender({ live: false }),
    setLive: (live: boolean): void => rerender({ live }),
    setSession: (props: { live: boolean; enabled: boolean }): void => rerender(props),
  };
}

/** Let the clock run, and every read it schedules settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the badge cadence', () => {
  it('polls every minute when nothing says a channel is up', async () => {
    const { reads } = mountBadge({});
    await elapse(0);
    const first = reads();

    await elapse(BADGE_POLL_MS);

    expect(reads()).toBe(first + 1);
  });

  it('keeps no timer at all while the host says its channel is live', async () => {
    const { reads } = mountBadge({ live: true });
    await elapse(0);
    const first = reads();

    // Not the minute, and not the old five-minute reconcile either: a live
    // badge hears its news, and a timer here would be a poll on a working stream.
    await elapse(BADGE_RECONCILE_MS * 3);

    expect(reads()).toBe(first);
  });

  it('keeps the reconcile for a factory subscription that cannot say whether it is up', async () => {
    const { transport, get } = recordingTransport();
    const store = createInboxStore(createNotificationsApiClient(API_BASE, transport));
    // Stable, as a factory-time subscription is: a new one per render re-subscribes.
    const options = { subscribe: () => () => undefined };
    renderHook(() => useUnreadCount(store, options));
    const reads = (): number => get.mock.calls.filter(([path]) => path === UNREAD_PATH).length;
    await elapse(0);
    const first = reads();

    await elapse(BADGE_POLL_MS);
    expect(reads()).toBe(first);
    await elapse(BADGE_RECONCILE_MS - BADGE_POLL_MS);
    expect(reads()).toBe(first + 1);
  });

  it('goes back to the minute the moment the channel drops', async () => {
    const { dropChannel, reads } = mountBadge({ live: true });
    await elapse(0);

    dropChannel();
    await elapse(0);
    const afterDrop = reads();

    await elapse(BADGE_POLL_MS);

    expect(reads()).toBe(afterDrop + 1);
  });
});

/**
 * The host's channel coming up, going down, and coming back.
 *
 * Every transition to live is one read — the first one after mount included.
 * With no timer while live, nothing else bounds an event published between the
 * mount read and the subscription opening, or one pushed while the stream was
 * down. A channel ALREADY live at mount adds nothing: the mount read is that read.
 */
describe('the badge and the channel coming back', () => {
  it('reads once more when the channel first comes up after mount', async () => {
    const badge = mountBadge({ live: false });
    await elapse(0);
    expect(badge.reads()).toBe(1);

    badge.setLive(true);
    await elapse(0);

    expect(badge.reads()).toBe(2);
  });

  it('adds no read when the channel is already live at mount', async () => {
    const badge = mountBadge({ live: true });
    await elapse(0);

    expect(badge.reads()).toBe(1);
  });

  it('reads exactly once more when the channel comes back after a drop', async () => {
    const badge = mountBadge({ live: true });
    await elapse(0);
    expect(badge.reads()).toBe(1);

    badge.setLive(false);
    await elapse(0);
    badge.setLive(true);
    await elapse(0);

    expect(badge.reads()).toBe(2);
  });

  it('reads on the channel coming up after a sign-in, as on any first live', async () => {
    const badge = mountBadge({ live: true, enabled: true });
    await elapse(0);

    // Signed out: the bell is disabled and the session-scoped channel drops.
    badge.setSession({ live: false, enabled: false });
    await elapse(0);
    // Signed back in: the mount read, then the channel coming up.
    badge.setSession({ live: false, enabled: true });
    await elapse(0);
    badge.setSession({ live: true, enabled: true });
    await elapse(0);

    // The first mount, the sign-in's own mount read, and the channel opening.
    expect(badge.reads()).toBe(3);
  });

  it('adds no read when the channel is live in the same render that signs in', async () => {
    const badge = mountBadge({ live: true, enabled: true });
    await elapse(0);
    badge.setSession({ live: false, enabled: false });
    await elapse(0);

    badge.setSession({ live: true, enabled: true });
    await elapse(0);

    // The sign-in's mount read IS the read for a channel already up.
    expect(badge.reads()).toBe(2);
  });
});
