// @vitest-environment jsdom
/**
 * Bumping the terms version must PROMPT, never block (FUT-462).
 *
 * The failure being pinned is a production one: a user who had accepted the previous
 * terms stayed signed in — avatar, cart, badge all intact — while the checkout
 * answered a bare `401 {"error":"Unauthorized"}` at the payment step, rendered
 * verbatim, with a "Tentar novamente" that could never succeed. The server could
 * already record a fresh acceptance; nothing told the user they owed one.
 *
 * Ported from `@repo/spa-shared`'s terms-consent suite. What changed in the move is
 * the realtime half: the dialog used to import a realtime provider directly, and now
 * takes a `useSignal` hook as CONFIG so this package carries no realtime client. The
 * cases below drive that seam by hand, which is closer to what they were always
 * asserting — that a reconnect and a pushed hint both RE-ASK the server.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLUB_MESSAGES } from '../../__tests__/host-copy';
import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import { TermsConsentDialog, type ConsentSignalHook } from '../consent/terms-consent-dialog';

/** Stub `fetch` for the status check and the acceptance POST. */
function server(options: { stale: boolean; acceptOk?: boolean }): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes(CONSENT_STATUS_PATH)) {
      // The package's own envelope — `{ data }`, as `createApiAppShell` answers.
      return {
        ok: true,
        json: async () => ({ data: { stale: options.stale, version: '2026-07-27' } }),
      } as Response;
    }
    if (url.includes(CONSENT_ACCEPT_PATH)) {
      return { ok: options.acceptOk ?? true, status: 204 } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return calls;
}

/**
 * A hand-driven stand-in for a host's event system.
 *
 * `connected` starts false and the test flips it, which is exactly the two moments
 * that matter: the reconnect after a deploy, and a pushed acceptance from the user's
 * other device.
 */
function signal(): {
  hook: ConsentSignalHook;
  connect: () => void;
  push: () => void;
} {
  // A container's properties, not closed-over bindings: the flakiness gate is right
  // that reassigning a binding from inside a stub is how a case leaks into the next.
  const state: { connected: boolean; listeners: Set<() => void> } = {
    connected: false,
    listeners: new Set(),
  };
  return {
    // A real implementation re-renders its consumer when the status changes; here the
    // test re-renders explicitly, which keeps the moment under `act`.
    hook: (onSignal) => {
      state.listeners.add(onSignal);
      return { connected: state.connected };
    },
    connect: () => {
      state.connected = true;
    },
    push: () => {
      for (const listener of state.listeners) listener();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('TermsConsentDialog', () => {
  it('stays out of the way when the acceptance is current', async () => {
    server({ stale: false });
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);
    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());
  });

  it('asks a stale user to accept, instead of letting a guard dead-end them', async () => {
    server({ stale: true });
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);

    const dialog = await screen.findByTestId('terms-consent-dialog');
    // Says WHY. The failure it replaces stopped the user without telling them
    // anything they could act on.
    expect(dialog.textContent).toContain('Sua associação continua em dia');
  });

  it('records the acceptance and gets out of the way', async () => {
    const calls = server({ stale: true });
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);

    fireEvent.click(await screen.findByTestId('terms-consent-accept'));

    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());
    expect(calls).toContain(`POST /api${CONSENT_ACCEPT_PATH}`);
  });

  /**
   * The accept endpoint PROPAGATES a stamping failure rather than answering 204,
   * precisely so this cannot claim success while leaving the user locked out of every
   * guard. Dismissing here would restore the silent dead end.
   */
  it('keeps asking when the server could not record the acceptance', async () => {
    server({ stale: true, acceptOk: false });
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);

    fireEvent.click(await screen.findByTestId('terms-consent-accept'));

    await waitFor(() => expect(screen.getByTestId('terms-consent-dialog')).toBeDefined());
  });

  /** A host that mounted the surface elsewhere moves both calls with one prop. */
  it('asks wherever the host mounted the surface', async () => {
    const calls = server({ stale: false });
    render(<TermsConsentDialog apiBase="/backend/v1" messages={CLUB_MESSAGES} />);
    await waitFor(() => expect(calls).toContain(`GET /backend/v1${CONSENT_STATUS_PATH}`));
  });

  it('renders the copy of a host in another language', async () => {
    // The seam is not a translation feature — it is where the sentences come
    // from at all. Nothing in the package has an opinion about the language.
    server({ stale: true });
    render(<TermsConsentDialog messages={{ ...CLUB_MESSAGES, consentAccept: 'I accept' }} />);
    expect(await screen.findByText('I accept')).toBeDefined();
  });
});

/**
 * The realtime half (FUT-462): a tab that was ALREADY OPEN when the terms changed.
 *
 * The fetch on mount only covers someone who loads a page after the bump. Everyone
 * else is sitting on a rendered app, and the first thing they used to hear was the
 * checkout's `401`. A version bump ships as a deploy — the process restarts, every
 * open stream drops, the tab reconnects — so re-asking on connect turns that restart
 * into the notification.
 */
describe('TermsConsentDialog · the realtime accelerator', () => {
  it('asks again when the signal (re)connects, so an open tab learns about a bump', async () => {
    const options = { stale: false };
    server(options);
    const stream = signal();
    const view = render(<TermsConsentDialog messages={CLUB_MESSAGES} useSignal={stream.hook} />);

    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());

    // The bump lands while this tab is open: the next answer is "stale", and the
    // reconnect is what goes and gets it.
    options.stale = true;
    stream.connect();
    await act(async () => {
      view.rerender(<TermsConsentDialog messages={CLUB_MESSAGES} useSignal={stream.hook} />);
    });

    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
  });

  it('re-reads on a pushed hint rather than trusting its payload', async () => {
    const options = { stale: false };
    server(options);
    const stream = signal();
    render(<TermsConsentDialog messages={CLUB_MESSAGES} useSignal={stream.hook} />);

    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());
    options.stale = true;
    // Deliberately a bare hint with no consent state in it — a best-effort bus is
    // best-effort, so the server's answer stays the only thing that decides.
    await act(async () => {
      stream.push();
    });

    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
  });

  /**
   * A host with no event system gets the mount-time fetch and nothing else — and
   * must not be told it is live. The seam being absent is a declaration, so the
   * no-op default reports `connected: false` rather than pretending.
   */
  it('works with no signal wired at all', async () => {
    server({ stale: true });
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);
    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
  });
});

/**
 * The dialog must not cover the documents it is asking about.
 *
 * `persistent` plus app-wide mounting meant the terms page rendered the terms behind
 * an un-dismissable modal telling the reader to go read the terms — and its only two
 * links pointed right back under it.
 */
describe('TermsConsentDialog · reading the documents', () => {
  function at(pathname: string): void {
    window.history.replaceState({}, '', pathname);
  }

  it('gets out of the way on the terms and privacy pages', async () => {
    server({ stale: true });
    at('/terms');
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);
    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());

    cleanup();
    at('/privacidade/');
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);
    await waitFor(() => expect(screen.queryByTestId('terms-consent-dialog')).toBeNull());
  });

  it('still asks everywhere else, including on a page whose path merely starts alike', async () => {
    server({ stale: true });
    at('/terms-de-parceria');
    render(<TermsConsentDialog messages={CLUB_MESSAGES} />);
    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
  });
});
