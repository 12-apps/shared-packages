// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedirectActivationCopy } from '../copy';
import { useRedirectActivation } from '../use-redirect-activation';

/**
 * The wiring around the decisions: what happens on mount, what each ask
 * carries, and what a refusal to MINT does to the owner's earlier step.
 *
 * The expensive lesson pinned here is the resume: the owner is deliberately
 * sent to another site to pay, so coming back is the normal path. A screen that
 * forgets the outstanding charge offers to mint a second real one.
 */

const COPY: RedirectActivationCopy = {
  chargeExpired: 'copy:expired',
  confirmFailed: 'copy:confirm-failed',
  createFailed: 'copy:create-failed',
  confirmTimedOut: 'copy:timed-out',
};

const URL_UNDER_TEST = '/api/admin/loja/payments/providers/redirect/verify-charge';

/**
 * A fixed `startedAt` for the server's pending row.
 *
 * Fixed rather than "now" so the clock is never a variable in these cases: what
 * matters is whether the elapsed time has passed the bound, and each test says
 * which side of it it is on by choosing `pollTimeoutMs` — not by hoping the
 * wall clock stays put between two lines.
 */
const STARTED_AT = new Date(1_700_000_000_000).toISOString();

/** Far past any elapsed time, for the cases that are not about the bound. */
const NO_TIMEOUT = Number.MAX_SAFE_INTEGER;

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** A fetch stub that records every ask, and answers from a queue per method. */
function stubFetch(answers: { get?: unknown; post?: unknown[] }) {
  const calls: Call[] = [];
  const posts = [...(answers.post ?? [])];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url: String(input),
      method,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    const payload = method === 'GET' ? answers.get : (posts.shift() ?? { pending: true });
    return { ok: true, json: async () => payload } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, posted: () => calls.filter((c) => c.method === 'POST') };
}

/**
 * One stable options object per test.
 *
 * Built OUTSIDE the render callback on purpose: a fresh object per render is
 * the caller mistake this hook is now proof against, and it has its own test
 * below. Every other case here wants to observe the protocol, not the guard.
 */
function options(
  overrides: Partial<Parameters<typeof useRedirectActivation>[0]> = {},
): Parameters<typeof useRedirectActivation>[0] {
  return {
    verifyChargeUrl: URL_UNDER_TEST,
    onVerified: vi.fn(),
    copy: COPY,
    ...overrides,
  };
}

/** Render with ONE options object, held across every re-render. */
function usingOptions(opts: Parameters<typeof useRedirectActivation>[0]) {
  return () => useRedirectActivation(opts);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/config/payments');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useRedirectActivation — on mount', () => {
  it('idles when the server holds no outstanding charge', async () => {
    const io = stubFetch({ get: {} });
    const { result } = renderHook(usingOptions(options()));

    await waitFor(() => expect(io.calls.some((c) => c.method === 'GET')).toBe(true));
    expect(result.current.state).toEqual({ kind: 'idle' });
    // Nothing outstanding and nothing carried back: no reason to ask.
    expect(io.posted()).toHaveLength(0);
  });

  it('resumes the outstanding charge the server remembers', async () => {
    stubFetch({
      get: {
        pending: {
          reference: 'ref-1',
          checkoutUrl: 'https://pay.example/abc',
          startedAt: STARTED_AT,
        },
      },
      post: [{ pending: true }],
    });
    const { result } = renderHook(usingOptions(options()));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        kind: 'awaiting',
        checkoutUrl: 'https://pay.example/abc',
      }),
    );
  });

  it('confirms from the FIRST frame when the owner came back holding ids', async () => {
    window.history.replaceState({}, '', '/config/payments?transaction_nsu=TX9&slug=loja');
    stubFetch({ get: {}, post: [{ pending: true }] });

    const { result } = renderHook(usingOptions(options()));

    // Never `idle`, and never a pay button: this owner has demonstrably paid.
    expect(result.current.state).toEqual({ kind: 'awaiting', checkoutUrl: null });

    // Let the resume sequence finish, so its state lands inside the test.
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('asks with the returned ids BEFORE reading the pending row', async () => {
    window.history.replaceState({}, '', '/config/payments?transaction_nsu=TX9&slug=loja');
    const io = stubFetch({ get: {}, post: [{ ok: true }] });
    const onVerified = vi.fn();

    renderHook(usingOptions(options({ onVerified })));

    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    // The order is the fix: chaining this ask behind the GET is how a
    // mid-refresh session cookie once turned a confirmed payment into a pay
    // button.
    expect(io.calls[0]?.method).toBe('POST');
    expect(io.calls[0]?.body).toMatchObject({
      action: 'poll',
      transactionNsu: 'TX9',
      slug: 'loja',
    });
  });

  it('honours a charge the server settled during the very read that reported it', async () => {
    stubFetch({ get: { proven: true } });
    const onVerified = vi.fn();

    const { result } = renderHook(usingOptions(options({ onVerified })));

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'passed' }));
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('does not re-ask when the return trip already answered', async () => {
    window.history.replaceState({}, '', '/config/payments?transaction_nsu=TX9');
    const io = stubFetch({
      get: {
        pending: {
          reference: 'ref-1',
          checkoutUrl: 'https://pay.example/abc',
          startedAt: STARTED_AT,
        },
      },
      post: [{ pending: true }],
    });

    renderHook(usingOptions(options()));

    await waitFor(() => expect(io.calls.some((c) => c.method === 'GET')).toBe(true));
    // One ask, the one that carried the ids — not a second for the pending row.
    await waitFor(() => expect(io.posted()).toHaveLength(1));
  });
});

describe('useRedirectActivation — minting the link', () => {
  it('opens the claimed tab at the minted link and starts asking', async () => {
    const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => tab));
    stubFetch({ get: {}, post: [{ ok: true, checkoutUrl: 'https://pay.example/xyz' }] });

    const { result } = renderHook(usingOptions(options()));
    await act(async () => {
      await result.current.start();
    });

    expect(tab.location.replace).toHaveBeenCalledWith('https://pay.example/xyz');
    expect(tab.opener).toBeNull();
    expect(result.current.state).toEqual({
      kind: 'awaiting',
      checkoutUrl: 'https://pay.example/xyz',
    });
  });

  it('a REFUSAL closes the tab and withdraws the owner’s earlier step', async () => {
    const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => tab));
    stubFetch({ get: {}, post: [{ ok: false, reason: 'checkout off' }] });
    const onCreateFailed = vi.fn();

    const { result } = renderHook(usingOptions(options({ onCreateFailed })));
    await act(async () => {
      await result.current.start();
    });

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({
      kind: 'failed',
      reason: 'checkout off',
      atCreation: true,
    });
    expect(onCreateFailed).toHaveBeenCalledTimes(1);
  });

  it('a TRANSPORT failure leaves that step alone — nothing was refused', async () => {
    const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => tab));
    stubFetch({ get: {}, post: [{ transport: true }] });
    const onCreateFailed = vi.fn();

    const { result } = renderHook(usingOptions(options({ onCreateFailed })));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toMatchObject({ atCreation: true, transport: true });
    expect(onCreateFailed).not.toHaveBeenCalled();
  });
});

describe('useRedirectActivation — asking and giving up', () => {
  it('checkNow carries the parked ids, ask after ask', async () => {
    window.history.replaceState({}, '', '/config/payments?transaction_nsu=TX9');
    const io = stubFetch({ get: {}, post: [{ pending: true }, { pending: true }] });

    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.posted().length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.checkNow();
    });

    const last = io.posted().at(-1);
    expect(last?.body).toMatchObject({ action: 'poll', transactionNsu: 'TX9' });
    expect(result.current.lastCheckedAt).toBeGreaterThan(0);
  });

  it('stamps lastCheckedAt even when the ask drops — the screen is still asking', async () => {
    stubFetch({ get: {} });
    vi.mocked(fetch).mockImplementation(async () => {
      throw new Error('offline');
    });

    const { result } = renderHook(usingOptions(options()));
    await act(async () => {
      await result.current.checkNow();
    });

    expect(result.current.lastCheckedAt).toBeGreaterThan(0);
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('giving up tells the SERVER, not just the screen', async () => {
    const io = stubFetch({ get: {}, post: [{ pending: true }] });

    const { result } = renderHook(usingOptions(options()));
    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toEqual({ kind: 'idle' });
    await waitFor(() =>
      expect(io.posted().some((c) => c.body?.action === 'discard')).toBe(true),
    );
  });

  it('stops asking once the bounded wait elapses, in the host’s own words', async () => {
    vi.useFakeTimers();
    try {
      stubFetch({
        get: {
          pending: {
            reference: 'ref-1',
            checkoutUrl: 'https://pay.example/abc',
            startedAt: STARTED_AT,
          },
        },
        post: [{ pending: true }],
      });

      const { result } = renderHook(usingOptions(options({ pollMs: 10, pollTimeoutMs: 20 })));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });

      expect(result.current.state).toEqual({ kind: 'failed', reason: COPY.confirmTimedOut });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useRedirectActivation — a caller that does not memoize', () => {
  it('resumes ONCE, however many times the caller re-renders with fresh callbacks', async () => {
    const io = stubFetch({
      get: {
        pending: {
          reference: 'ref-1',
          checkoutUrl: 'https://pay.example/abc',
          startedAt: STARTED_AT,
        },
      },
      post: [{ pending: true }, { pending: true }, { pending: true }],
    });

    // Every render hands the hook brand-new function identities — the obvious
    // way to call it (`{ onVerified: () => reload() }`), and the way that used
    // to re-mount the resume sequence on its own state update, for ever.
    const { rerender } = renderHook(() =>
      useRedirectActivation({
        verifyChargeUrl: URL_UNDER_TEST,
        onVerified: () => undefined,
        onCreateFailed: () => undefined,
        copy: { ...COPY },
      }),
    );

    await waitFor(() => expect(io.calls.some((c) => c.method === 'GET')).toBe(true));
    rerender();
    rerender();
    await waitFor(() => expect(io.posted().length).toBeGreaterThan(0));

    expect(io.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('keeps ticking — a re-render must not restart the interval before it fires', async () => {
    vi.useFakeTimers();
    try {
      const io = stubFetch({
        get: {
          pending: {
            reference: 'ref-1',
            checkoutUrl: 'https://pay.example/abc',
            startedAt: STARTED_AT,
          },
        },
        post: [{ pending: true }, { pending: true }, { pending: true }, { pending: true }],
      });

      const { rerender } = renderHook(() =>
        useRedirectActivation({
          verifyChargeUrl: URL_UNDER_TEST,
          onVerified: () => undefined,
          copy: { ...COPY },
          pollMs: 50,
          pollTimeoutMs: NO_TIMEOUT,
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const before = io.posted().length;

      // Re-render just under the tick, twice — with the callbacks in the deps
      // this cleared and re-armed the timer each time, so it never fired.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });

      expect(io.posted().length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
