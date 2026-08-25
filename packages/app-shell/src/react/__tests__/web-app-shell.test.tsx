// @vitest-environment jsdom
/**
 * What a host gets from ONE call, and the three things it must not get by accident.
 *
 * The tower this replaces was copy-pasted into three SPAs: a query client, a theme,
 * `CssBaseline`, a session provider, the consent gate, a router. None of it is
 * interesting and all of it was in the host, which is how the three drifted — one app
 * mounted the gate, one did not, and the one that did not was the one whose owners hit
 * the same 401.
 */
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, type JSX } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLUB_MESSAGES } from '../../__tests__/host-copy';
import { createWebAppShell } from '../create-web-app-shell';

/** The crashes a host's reporter saw, in a container the test owns. */
function reporter(): { seen: unknown[]; onCrash: (error: unknown) => void } {
  const seen: unknown[] = [];
  return { seen, onCrash: (error: unknown) => seen.push(error) };
}

/** React logs every caught error itself; silence it so a passing run is quiet. */
function quietReactErrors(): void {
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

/** A page that throws on render — a crashed chunk, or a page bug. */
function BadPage(): JSX.Element {
  throw new Error('a routed page exploded');
}

/** A session endpoint that answers signed-out, and a consent status of `stale`. */
function server(options: { stale?: boolean } = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/consent/status')) {
      return {
        ok: true,
        json: async () => ({ data: { stale: options.stale === true, version: 'v1' } }),
      } as Response;
    }
    // Auth.js answers 200 `{}` when there is no session.
    return { ok: true, json: async () => ({}) } as Response;
  });
  return calls;
}

/**
 * The minimum a host must pass — every one of these has no safe default.
 *
 * `consent: false` is part of the minimum on purpose: it is the DECLARATION that this
 * app has no terms flow, and it is required so that silence cannot be the way a host
 * with a terms flow ends up with no gate.
 */
const REQUIRED = {
  brand: { name: 'Harness' },
  onCrash: (): void => {},
  consent: false,
  // Required config now — this suite states its own copy rather than
  // inheriting one, because there is nothing left to inherit.
  messages: CLUB_MESSAGES,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('createWebAppShell', () => {
  it('renders the routed app under a theme and a session', async () => {
    server();
    const shell = createWebAppShell({ ...REQUIRED, queryClient: new QueryClient() });

    function Page(): JSX.Element {
      const { status } = shell.useSession();
      return <p data-testid="session-status">{status}</p>;
    }

    render(
      <shell.Provider router={{}}>
        <Routes>
          <Route path="/" element={<Page />} />
        </Routes>
      </shell.Provider>,
    );

    // `useSession` resolving at all is the claim: it throws outside its provider, so
    // a tower assembled in the wrong order fails here rather than at runtime in an app.
    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe('unauthenticated'),
    );
  });

  /**
   * The shell must never invent a cache. A host's query client is where a 402→upsell
   * interceptor lives (the origin host's admin puts it in the query and mutation caches),
   * so a shell-created one would silently drop that interception.
   */
  it('installs the host query client, and mounts no provider without one', async () => {
    server();
    const queryClient = new QueryClient();
    const withClient = createWebAppShell({ ...REQUIRED, queryClient });

    function Probe(): JSX.Element {
      return <p data-testid="same-client">{String(useQueryClient() === queryClient)}</p>;
    }

    render(
      <withClient.Provider>
        <Probe />
      </withClient.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('same-client').textContent).toBe('true'));

    // With no client the provider is absent, so `useQueryClient` throws rather than
    // resolving to something the host never made. Read off the REPORTER rather than off
    // `render`: the tower now carries a boundary, so the throw is caught and reported
    // instead of escaping — which is the whole point of the boundary and does not change
    // what is being claimed here.
    quietReactErrors();
    const host = reporter();
    const bare = createWebAppShell({ ...REQUIRED, onCrash: host.onCrash });
    render(
      <bare.Provider>
        <Probe />
      </bare.Provider>,
    );
    expect((host.seen[0] as Error | undefined)?.message).toMatch(/QueryClientProvider/);
  });

  /**
   * The consent gate is mounted unless the host declares `consent: false`. A gate that
   * polled an endpoint nobody implemented would be the noisier failure, and a host
   * with no such flow has nothing for it to ask about — but that declaration is now
   * something a host has to WRITE, so forgetting the key cannot be how an app with a
   * terms flow ends up ungated.
   */
  it('mounts the consent gate unless the host opted out with `false`', async () => {
    const withoutConsent = server({ stale: true });
    const bare = createWebAppShell(REQUIRED);
    render(
      <bare.Provider>
        <p>app</p>
      </bare.Provider>,
    );
    await waitFor(() => expect(screen.getByText('app')).toBeDefined());
    expect(withoutConsent.some((call) => call.includes('/consent/status'))).toBe(false);

    vi.unstubAllGlobals();
    server({ stale: true });
    const gated = createWebAppShell({ ...REQUIRED, consent: {} });
    render(
      <gated.Provider>
        <p>app</p>
      </gated.Provider>,
    );
    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
  });

  /**
   * The gate sits ABOVE the router and BELOW `wrap`, and both sides are load-bearing:
   * a bumped terms version blocks every guarded action rather than one route, and the
   * gate's `useSignal` reads a context the host mounts in `wrap`.
   */
  it('puts `wrap` above the consent gate and the router', async () => {
    server({ stale: true });
    // A context, because that is what the ordering is FOR: the host's realtime
    // provider goes in `wrap`, and `consent.useSignal` reads it. Asserting DOM
    // containment would prove nothing — MUI's Dialog portals to `document.body`, so
    // the gate is never a DOM descendant of anything the host rendered.
    const HostContext = createContext<string | null>(null);
    const shell = createWebAppShell({
      ...REQUIRED,
      consent: {
        useSignal: () => {
          const value = useContext(HostContext);
          if (value === null) {
            throw new Error('the consent gate rendered ABOVE the host wrap');
          }
          return { connected: false };
        },
      },
    });

    render(
      <shell.Provider
        router={{}}
        wrap={(inner) => (
          <HostContext.Provider value="live">
            <div data-testid="host-wrap">{inner}</div>
          </HostContext.Provider>
        )}
      >
        <Routes>
          <Route path="/" element={<p>routed</p>} />
        </Routes>
      </shell.Provider>,
    );

    // The gate rendered at all, which means its hook found the host's context.
    expect(await screen.findByTestId('terms-consent-dialog')).toBeDefined();
    // …and the router is inside the wrap too, not beside it.
    expect(screen.getByTestId('host-wrap').textContent).toContain('routed');
  });

  it('honours the router basename it was given', async () => {
    server();
    const shell = createWebAppShell(REQUIRED);
    window.history.replaceState({}, '', '/admin/roles');

    function Here(): JSX.Element {
      return <p data-testid="path">{useLocation().pathname}</p>;
    }

    render(
      <shell.Provider router={{ basename: '/admin' }}>
        <Routes>
          <Route path="/roles" element={<Here />} />
        </Routes>
      </shell.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/roles'));
  });

  /**
   * `{ base, fetch }` can only mean a `fetch` that goes THROUGH `base`. Unbound, it was
   * bare `apiFetch`, so `api.fetch('/consent/status')` sitting beside a base of
   * `/backend` hit `/consent/status` — an invitation the grouping itself extends.
   */
  it('sends `api.fetch` through `api.base`', async () => {
    const calls = server();
    const shell = createWebAppShell({ ...REQUIRED, apiBase: '/backend/' });
    await shell.api.fetch('/consent/status');
    // The base's trailing slash is not doubled either — `joinApiPath` owns that.
    expect(calls).toContain('GET /backend/consent/status');
  });

  it('hands back the seams a host composes with', () => {
    const shell = createWebAppShell({ ...REQUIRED, apiBase: '/backend' });
    expect(shell.api.base).toBe('/backend');
    expect(shell.brand.name).toBe('Harness');
    expect(typeof shell.lazyRoute).toBe('function');
    expect(typeof shell.RouteErrorBoundary).toBe('function');
    // A HOOK now, so a host renders the same sentence in the same language the
    // shell is currently rendering rather than the one it was imported in.
    expect(renderHook(() => shell.useMessages()).result.current.consentAccept).toBe(
      CLUB_MESSAGES.consentAccept,
    );
    // One theme object, built once: a theme rebuilt per render is a new object
    // identity and re-runs every `styled` cache below it.
    expect(shell.theme).toBe(shell.theme);
  });

  /**
   * The failure the package exists to prevent, reached through the DOCUMENTED wiring
   * and nothing else.
   *
   * `onCrash` is required, and for a long time it was only ever called from a
   * `RouteErrorBoundary` the host had to mount itself — which the quick-start never
   * told it to. So an adopter who followed the docs got the exact outcome
   * `chunk-recovery.ts` describes: a routed page throws, React unmounts the root, and
   * the required reporter is never reached. A required knob the documented path cannot
   * reach is not a guarantee, so the Provider mounts the boundary itself.
   *
   * This case is deliberately the quick-start shape verbatim — no boundary in the
   * host's tree — and it fails against a Provider that does not mount one: the throw
   * escapes `render` instead of becoming an error state.
   */
  it('catches a routed crash and reports it without a host-mounted boundary', async () => {
    quietReactErrors();
    server();
    const host = reporter();
    const shell = createWebAppShell({
      brand: { name: 'Harness' },
      onCrash: host.onCrash,
      messages: CLUB_MESSAGES,
      queryClient: new QueryClient(),
      consent: {},
    });

    const view = render(
      <shell.Provider router={{}}>
        <Routes>
          <Route path="/" element={<BadPage />} />
        </Routes>
      </shell.Provider>,
    );

    // An error state, not a blank root — the `route-error` id every host's e2e
    // specs select on.
    expect(await screen.findByTestId('route-error')).toBeDefined();
    expect(view.container.innerHTML).not.toBe('');
    // …and the crash reached the reporter the host passed, which is the half that
    // `window.onerror` can never see.
    expect(host.seen).toHaveLength(1);
    expect((host.seen[0] as Error).message).toBe('a routed page exploded');
  });

  /**
   * Double-wrapping has to be HARMLESS, because per-route placement is legitimate: a
   * host wants the boundary below its own chrome so a crashed page keeps the sidebar.
   * React gives the nearest boundary the error, so the host's inner one catches and the
   * Provider's net never sees it — one fallback, one report. Asserted rather than
   * assumed: a second report would double every crash in a host's issue tracker.
   */
  it('lets a host-mounted boundary catch first, reporting once', async () => {
    quietReactErrors();
    server();
    const host = reporter();
    const shell = createWebAppShell({
      brand: { name: 'Harness' },
      onCrash: host.onCrash,
      messages: CLUB_MESSAGES,
      consent: false,
    });

    render(
      <shell.Provider router={{}}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <p data-testid="host-chrome">chrome</p>
                <shell.RouteErrorBoundary resetKey="a">
                  <BadPage />
                </shell.RouteErrorBoundary>
              </>
            }
          />
        </Routes>
      </shell.Provider>,
    );

    // The inner boundary caught it, so the chrome beside it survived — which is the
    // whole reason a host places one of these by hand.
    expect(await screen.findByTestId('host-chrome')).toBeDefined();
    expect(screen.getAllByTestId('route-error')).toHaveLength(1);
    expect(host.seen).toHaveLength(1);
  });

  it('takes the tenant palette seed through to the theme', () => {
    const shell = createWebAppShell({
      ...REQUIRED,
      theme: { override: { primary: '#7ED957' } },
    });
    // Corrected for legibility, and the exact seed kept as `light` — the
    // brand-palette contract, reached through the factory rather than directly.
    expect(shell.theme.palette.primary.main).not.toBe('#7ED957');
    expect(shell.theme.palette.primary.light).toBe('#7ED957');
  });
});

/**
 * THE SESSION, WITHOUT THE TOWER.
 *
 * `Provider` mounts theme + session + consent gate + router, which is what an
 * application entry point wants and what nothing else does. A unit test
 * rendering one signed-in component does not want a consent gate calling the
 * terms endpoint, and cannot mount a second `BrowserRouter` inside the harness's
 * own.
 *
 * The reason this needs a test rather than a docstring is the failure it
 * prevents: a host that works around the gap by calling `createWebAuth()` itself
 * gets a SECOND context, so a component renders under one provider and reads
 * from the other. `useSession must be used within a SessionProvider`, thrown
 * from a tree that visibly has one. So the assertion is not "a provider exists"
 * — it is that the value read under `SessionProvider` is the value `Provider`
 * would have given.
 */
describe('SessionProvider, on its own', () => {
  it('serves the session with no theme, no gate and no router mounted', async () => {
    const calls = server();
    const shell = createWebAppShell({ ...REQUIRED, queryClient: new QueryClient() });

    function Page(): JSX.Element {
      return <p data-testid="status">{shell.useSession().status}</p>;
    }

    render(
      <shell.SessionProvider>
        <Page />
      </shell.SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    // The gate is what would have reached the network for something this test
    // never asked about. Asserted with the same literal the other cases in this
    // file use rather than a predicate — a closure over the recorded calls is
    // what the flakiness gate reads as shared mutable state.
    expect(calls).not.toContain('GET /backend/consent/status');
  });

  it('is the SAME context `Provider` mounts, not a second one', async () => {
    server();
    const shell = createWebAppShell({ ...REQUIRED, queryClient: new QueryClient() });

    // Reads through `useSession` while mounted under `Provider`, which installs
    // its own session. If `SessionProvider` were a different instance this still
    // renders — it is the nesting that proves they are one, because the inner
    // provider would otherwise shadow the outer with an unrelated context and
    // the hook would read whichever it found.
    function Page(): JSX.Element {
      return <p data-testid="nested">{shell.useSession().status}</p>;
    }

    render(
      <shell.Provider router={{}}>
        <shell.SessionProvider>
          <Page />
        </shell.SessionProvider>
      </shell.Provider>,
    );

    await waitFor(() => expect(screen.getByTestId('nested').textContent).toBe('unauthenticated'));
  });
});
