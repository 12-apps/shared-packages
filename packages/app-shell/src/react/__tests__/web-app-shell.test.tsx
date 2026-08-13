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
import { render, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, type JSX } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebAppShell } from '../create-web-app-shell';

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

/** The minimum a host must pass — every one of these has no safe default. */
const REQUIRED = {
  brand: { name: 'Harness' },
  onCrash: (): void => {},
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
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
   * interceptor lives (future-pay's admin puts it in the query and mutation caches),
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
    // resolving to something the host never made.
    const bare = createWebAppShell(REQUIRED);
    expect(() =>
      render(
        <bare.Provider>
          <Probe />
        </bare.Provider>,
      ),
    ).toThrow(/QueryClientProvider/);
  });

  /**
   * The consent gate is mounted only when the host declares a terms flow. A gate that
   * polled an endpoint nobody implemented would be the noisier failure, and a host
   * with no such flow has nothing for it to ask about.
   */
  it('mounts the consent gate only when consent is configured', async () => {
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

  it('hands back the seams a host composes with', () => {
    const shell = createWebAppShell({ ...REQUIRED, apiBase: '/backend' });
    expect(shell.api.base).toBe('/backend');
    expect(shell.brand.name).toBe('Harness');
    expect(typeof shell.lazyRoute).toBe('function');
    expect(typeof shell.RouteErrorBoundary).toBe('function');
    expect(shell.messages.consentAccept).toBe('Li e aceito');
    // One theme object, built once: a theme rebuilt per render is a new object
    // identity and re-runs every `styled` cache below it.
    expect(shell.theme).toBe(shell.theme);
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
