// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVerificationAmount } from '../use-verification-amount';

/**
 * FUT-4200 — the link flow's probe. Whether the provider requires the payer
 * e-mail is UNKNOWN until the endpoint answers (the pay button waits for it),
 * forgotten when the screen moves to another provider, and `false` when the
 * read fails, so the button is never held forever.
 */

function answering(byUrl: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, json: async () => byUrl[url] ?? {} })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useVerificationAmount — the payer e-mail answer', () => {
  it('is unknown until the endpoint answers, then what it said', async () => {
    answering({ '/verify/pagbank': { amountCents: 100, payerEmailRequired: true } });
    const { result } = renderHook(() => useVerificationAmount('/verify/pagbank'));
    expect(result.current.payerEmailRequired).toBeNull();
    await waitFor(() => expect(result.current.payerEmailRequired).toBe(true));
  });

  it('forgets the previous provider when the URL changes', async () => {
    const held = { release: (): void => undefined };
    const gate = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/verify/infinitepay') await gate;
        return {
          ok: true,
          json: async () =>
            url === '/verify/pagbank'
              ? { amountCents: 100, payerEmail: 'a@x.example', payerEmailRequired: true }
              : { amountCents: 500 },
        };
      }),
    );
    const { result, rerender } = renderHook(({ url }) => useVerificationAmount(url), {
      initialProps: { url: '/verify/pagbank' },
    });
    await waitFor(() => expect(result.current.payerEmailRequired).toBe(true));

    rerender({ url: '/verify/infinitepay' });
    await waitFor(() => expect(result.current.payerEmailRequired).toBeNull());
    expect(result.current.payerEmail).toBeNull();
    expect(result.current.amountCents).toBeNull();

    held.release();
    await waitFor(() => expect(result.current.payerEmailRequired).toBe(false));
    expect(result.current.amountCents).toBe(500);
  });

  it('a failed read is false, so the pay button is not held forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const { result } = renderHook(() => useVerificationAmount('/verify/infinitepay'));
    await waitFor(() => expect(result.current.payerEmailRequired).toBe(false));
  });
});
