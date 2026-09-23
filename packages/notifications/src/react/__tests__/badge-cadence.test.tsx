// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotificationsApiClient } from '../api';
import type { NotificationsResult, NotificationsTransport } from '../transport';
import { useUnreadCount } from '../hooks';
import { BADGE_POLL_MS, BADGE_RECONCILE_MS, createInboxStore } from '../inbox-state';

/**
 * How often the badge asks for its count, and what relaxes it.
 *
 * A live channel relaxes the poll to the reconcile interval — five minutes,
 * never "stop" — and without one the badge asks every minute. `subscribe`
 * always implied a live channel. `live` is the host's own word for a channel
 * this package does not hold: a host that wires the invalidate itself, because
 * its connection is session-scoped and must stay behind `enabled`, had no way
 * to say it was listening, and every reader polled once a minute on top of a
 * working stream.
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
function mountBadge(options: { live?: boolean }) {
  const { transport, get } = recordingTransport();
  const store = createInboxStore(createNotificationsApiClient(API_BASE, transport));
  const { rerender } = renderHook((props: { live?: boolean }) => useUnreadCount(store, props), {
    initialProps: options,
  });
  return {
    reads: (): number => get.mock.calls.filter(([path]) => path === UNREAD_PATH).length,
    dropChannel: (): void => rerender({ live: false }),
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

  it('relaxes to the reconcile while the host says its channel is live', async () => {
    const { reads } = mountBadge({ live: true });
    await elapse(0);
    const first = reads();

    await elapse(BADGE_POLL_MS);
    expect(reads()).toBe(first);

    // Relaxed, never stopped: a dropped event must still expire on something.
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
