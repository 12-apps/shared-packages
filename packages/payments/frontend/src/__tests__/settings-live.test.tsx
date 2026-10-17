// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MerchantSettingsView } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { PaymentProviderSettings } from '../components/PaymentProviderSettings';
import type { PaymentsSettingsLiveSignal } from '../components/settings-live';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * The settings screen on the host's realtime channel (FUT-648).
 *
 * A connection moves outside the tab — the OAuth grant finishing in the tab the
 * owner sent to the provider, a colleague's save, a webhook settling the
 * activation charge. Three claims, each read off the client the screen reads
 * through, because the re-read IS the behaviour:
 *
 *   - a hint re-reads the view, and the screen shows what the re-read said;
 *   - the channel (re)opening re-reads too, the first open after mount
 *     included — the mount read may predate the subscription;
 *   - there is no timer, live or not: the screen never polled, and a host with
 *     no channel keeps exactly the mount read.
 */

const PROVIDERS = [
  { name: 'stripe', displayName: 'Stripe', authMode: 'credentials', credentialSchema: [] },
];

function view(status: string): MerchantSettingsView {
  return {
    providers: PROVIDERS,
    configs: [
      {
        provider: 'stripe',
        status,
        enabled: false,
        environment: 'PRODUCTION',
        environments: { PRODUCTION: {} },
        chargeVerifiedAt: null,
      },
    ],
    activeProvider: null,
  } as unknown as MerchantSettingsView;
}

/** A client whose `getSettings` answers the next queued view, then the last one. */
function fakeClient(...views: MerchantSettingsView[]) {
  const queue = [...views];
  const getSettings = vi.fn(() => Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]!));
  const client = {
    getSettings,
    getSetupGuide: vi.fn().mockResolvedValue(null),
    setEnabled: vi.fn(),
    saveCredentials: vi.fn(),
  } as unknown as PaymentsSettingsClient;
  return { client, reads: (): number => getSettings.mock.calls.length };
}

/** A scriptable host channel: whether it is live, and the hint it can deliver. */
function fakeChannel() {
  const listeners = new Set<() => void>();
  const subscribe = (onHint: () => void): (() => void) => {
    listeners.add(onHint);
    return () => listeners.delete(onHint);
  };
  return {
    signal: (live: boolean): PaymentsSettingsLiveSignal => ({ live, subscribe }),
    deliverHint: (): void => listeners.forEach((listener) => listener()),
    listening: (): number => listeners.size,
  };
}

function screenFor(client: PaymentsSettingsClient, live?: PaymentsSettingsLiveSignal) {
  return (
    <PaymentProviderSettings
      copy={PT_BR_PAYMENTS_SETTINGS_COPY}
      client={client}
      selectedProvider="stripe"
      live={live}
    />
  );
}

describe('the settings screen on the host channel', () => {
  it('re-reads on a hint and shows what the re-read says', async () => {
    const { client, reads } = fakeClient(view('UNVERIFIED'), view('VERIFIED'));
    const channel = fakeChannel();
    render(screenFor(client, channel.signal(true)));
    await waitFor(() => expect(reads()).toBe(1));
    const before = (await screen.findByTestId('payments-status')).textContent;

    await act(async () => {
      channel.deliverHint();
    });

    await waitFor(() => expect(reads()).toBe(2));
    // The chip is the re-read's answer, not the mount's.
    await waitFor(() =>
      expect(screen.getByTestId('payments-status').textContent).not.toBe(before),
    );
  });

  it('re-reads once when the channel first opens after mount', async () => {
    const { client, reads } = fakeClient(view('UNVERIFIED'));
    const channel = fakeChannel();
    const { rerender } = render(screenFor(client, channel.signal(false)));
    await waitFor(() => expect(reads()).toBe(1));

    rerender(screenFor(client, channel.signal(true)));

    await waitFor(() => expect(reads()).toBe(2));
  });

  it('re-reads again when the channel comes back after a drop, and not on the drop', async () => {
    const { client, reads } = fakeClient(view('UNVERIFIED'));
    const channel = fakeChannel();
    const { rerender } = render(screenFor(client, channel.signal(true)));
    await waitFor(() => expect(reads()).toBe(1));

    rerender(screenFor(client, channel.signal(false)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads()).toBe(1);

    rerender(screenFor(client, channel.signal(true)));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it('keeps no timer, live or not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { client, reads } = fakeClient(view('UNVERIFIED'));
      const channel = fakeChannel();
      const { rerender } = render(screenFor(client, channel.signal(true)));
      await waitFor(() => expect(reads()).toBe(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      rerender(screenFor(client, channel.signal(false)));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });

      expect(reads()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('subscribes nothing and reads once for a host with no channel', async () => {
    const { client, reads } = fakeClient(view('UNVERIFIED'));
    render(screenFor(client));

    await waitFor(() => expect(reads()).toBe(1));
  });

  it('lets go of the channel on unmount', async () => {
    const { client, reads } = fakeClient(view('UNVERIFIED'));
    const channel = fakeChannel();
    const { unmount } = render(screenFor(client, channel.signal(true)));
    await waitFor(() => expect(reads()).toBe(1));
    expect(channel.listening()).toBe(1);

    unmount();

    expect(channel.listening()).toBe(0);
  });
});
