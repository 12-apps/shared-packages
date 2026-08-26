/**
 * The one thing this package exposes to a FRONTEND host (12-18).
 *
 * What used to be a PRIVATE workspace package inside one application — one no
 * other app could install — assembled into one factory. Three SPAs each repeated the
 * same provider tower by hand: a query client, a theme, `CssBaseline`, a session
 * provider, the consent gate, then a router. The tower is not interesting and it is
 * not the host's business, but every line of it was in the host.
 *
 * ```tsx
 * const shell = createWebAppShell({
 *   brand: { name: 'Acme Storefront' },
 *   onCrash: reportRouteCrash,
 *   queryClient,
 *   consent: {},        // or `false` — the app has no terms flow
 * });
 *
 * export function App() {
 *   return (
 *     <shell.Provider router={{ basename }}>
 *       <AppRoutes />
 *     </shell.Provider>
 *   );
 * }
 * ```
 *
 * ## What is NOT in here, and where it went instead
 *
 *  - **The session.** `@12-apps/auth/react`'s `createWebAuth` already owns the
 *    CSRF-protected sign-in POST and the same-origin callback defence. The shell
 *    builds one and re-exports its `useSession`; it does not carry a second copy.
 *  - **Realtime.** `@12-apps/realtime` owns the client, the reconnect policy, the
 *    shared worker and the hooks. The consent gate's accelerator arrives as the
 *    `consent.useSignal` seam, so this package has no realtime code and no realtime
 *    dependency.
 *  - **The router's ROUTES.** They are the host's element tree, passed as `children`.
 *    The shell will wrap them in a `BrowserRouter` when given `router`, and will
 *    happily wrap nothing when the host brings its own — which is what keeps the
 *    coupling to `react-router-dom` optional rather than structural.
 *
 * ## The boundary is MOUNTED, not merely handed over
 *
 * `Provider` wraps everything below it in the shell's `RouteErrorBoundary`. It used to
 * only return one on the shell object, and that made `onCrash` — required, precisely so
 * a crash cannot go unreported — unreachable for anyone following the quick-start: a
 * routed page throws, React unmounts the root, blank page, nothing reported. A required
 * knob the documented path cannot reach is a config option pretending to be a
 * guarantee, so the tower carries the net itself.
 *
 * There is deliberately **no opt-out**. A host wanting the boundary below its own
 * chrome mounts a second one from `shell.RouteErrorBoundary`, which is additive: React
 * hands the error to the NEAREST boundary, so the host's inner one catches first, the
 * chrome survives, and `onCrash` fires exactly once. An `boundary: false` knob would buy
 * nothing that composition does not already give and would put the blank page back one
 * option away.
 *
 * ## Required, because the alternative fails OPEN
 *
 *  - `brand.name` — a package-supplied product name would put someone else's brand
 *    on a host's screens.
 *  - `onCrash` — see `route-error-boundary.ts`: the boundary's own default reports
 *    past the host's noise rules, so a crashed page can file an issue for a 404.
 *  - `consent` — `false` is the DECLARATION that a host has no terms flow. Omitting it
 *    silently meant the same thing, and that is the original dead end back again for a
 *    host that has a terms flow and forgot the key: the surface answers, nobody asks it,
 *    and a version bump strands every consented user. The server half's `isCurrent` is
 *    required for this exact reason; silence must not be one of the two answers.
 *  - `queryClient` — a shell-created client is a cache the host does not know about,
 *    and the host's cache is where a 402-to-upsell interceptor lives. Omit it and the
 *    shell mounts no provider at all rather than inventing one.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { CssBaseline } from '@12-apps/ui/mui/CssBaseline';
import { ThemeProvider } from '@12-apps/ui/mui/styles';
import type { Theme } from '@12-apps/ui/mui/styles';
import { createEmailAuth, createWebAuth } from '@12-apps/auth/react';

import { apiFetch, type ApiFetchOptions } from '../core/api';
import { joinApiPath } from '../core/paths';
import { TermsConsentDialog } from './consent/terms-consent-dialog';
import { lazyRoute } from './lazy-route';
import { messagesOf, noLocale, type AppShellMessages } from './messages';
import type { ShellProviderProps, WebAppShell, WebAppShellConfig } from './config';
import { createShellRouteErrorBoundary } from './route-error-boundary';
import { createAppTheme } from './theme';

/**
 * The net's `resetKey`.
 *
 * Constant, and that is the honest value for this position: the router is BELOW this
 * boundary, so once it has caught there is no navigation left to reset on — the
 * fallback's `reload` is the only retry that can help, which is exactly what the
 * boundary is configured with. A host that wants recovery-by-navigation mounts its own
 * inside its chrome with `useLocation().key`, and that inner one catches first.
 */
const SHELL_RESET_KEY = 'app-shell';

/**
 * The tower, innermost first, as its own function so `createWebAppShell` stays a
 * list of decisions rather than a nest of JSX.
 */
function buildProvider(
  config: WebAppShellConfig,
  parts: {
    theme: Theme;
    SessionProvider: (props: { children: ReactNode }) => JSX.Element;
    ConsentGate: () => JSX.Element | null;
    RouteErrorBoundary: ReturnType<typeof createShellRouteErrorBoundary>;
  },
): (props: ShellProviderProps) => JSX.Element {
  const { SessionProvider, ConsentGate, RouteErrorBoundary, theme } = parts;

  function ShellProvider({ wrap, router, children }: ShellProviderProps): JSX.Element {
    const routed = router ? (
      <BrowserRouter basename={router.basename}>{children}</BrowserRouter>
    ) : (
      children
    );
    const below = (
      <>
        {/*
          Above the router, deliberately. A bumped terms version blocks every
          guarded action rather than one route, and the failure it replaces only
          became visible at the payment step — the last place anyone wants to
          discover it.
        */}
        <ConsentGate />
        {routed}
      </>
    );
    const inner = wrap ? wrap(below) : below;
    const themed = (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/*
          Below the theme so the crashed-page fallback is still this host's design
          system, and above everything else so nothing under the shell can blank the
          document: the session provider, the host's own `wrap`, the consent gate and
          the routed pages are all inside it. This is the LAST resort, not the good
          boundary — a host mounts a second one below its chrome and that one catches
          first, keeping the chrome alive.
        */}
        <RouteErrorBoundary resetKey={SHELL_RESET_KEY}>
          <SessionProvider>{inner}</SessionProvider>
        </RouteErrorBoundary>
      </ThemeProvider>
    );
    // Only when the host gave us one: the shell never invents a cache.
    return config.queryClient ? (
      <QueryClientProvider client={config.queryClient}>{themed}</QueryClientProvider>
    ) : (
      themed
    );
  }
  ShellProvider.displayName = 'AppShellProvider';
  return ShellProvider;
}

/**
 * The config and the shell, re-exported from `./config` where their doctrine
 * now lives. Types only, so this costs the bundle nothing — see that module.
 */
export type {
  ShellBrand,
  ShellConsentConfig,
  ShellProviderProps,
  WebAppShell,
  WebAppShellConfig,
} from './config';

/** Build the browser shell. One call, one config object. */
export function createWebAppShell(config: WebAppShellConfig): WebAppShell {
  const apiBase = config.apiBase ?? '/api';
  const theme = createAppTheme(config.theme?.mode ?? 'light', config.theme ?? {});
  const authBasePath = config.authBasePath ?? '/api/auth';
  const auth = createWebAuth({ basePath: authBasePath });
  const emailAuth = createEmailAuth({
    basePath: config.emailAuthBasePath ?? `${authBasePath}/email`,
  });
  // Built ONCE, at factory time: a boundary rebuilt per render is a new component
  // type each time, so React would remount everything below it on every parent
  // render.
  const RouteErrorBoundary = createShellRouteErrorBoundary({
    onCrash: config.onCrash,
    // Passed straight through, SOURCE and seam alike: this factory runs at
    // import, so anything resolved on this line is resolved in whatever
    // language the first tab happened to load. The boundary's fallback is a
    // component and chooses for itself.
    messages: config.messages,
    ...(config.useLocale === undefined ? {} : { useLocale: config.useLocale }),
  });

  /**
   * The shell's strings, resolved in the CALLER's render.
   *
   * Declared inside the factory so it closes over this shell's config, and
   * named `use*` because it is one — a host calls it from a component, the
   * locale hook runs there, and the component re-renders when the reader
   * changes language.
   */
  function useMessages(): AppShellMessages {
    // Hooks may not be called conditionally; the no-op stands in for a host
    // that wired no locale seam.
    return messagesOf(config.messages, (config.useLocale ?? noLocale)());
  }

  const consent = config.consent;
  function ConsentGate(): JSX.Element | null {
    // `consent: false` is the host DECLARING it has no terms flow. Mounting a gate
    // that polls an endpoint nobody implemented would be the noisier failure.
    if (!consent) return null;
    return (
      <TermsConsentDialog
        apiBase={apiBase}
        messages={config.messages}
        {...(config.useLocale === undefined ? {} : { useLocale: config.useLocale })}
        {...(consent.termsHref === undefined ? {} : { termsHref: consent.termsHref })}
        {...(consent.privacyHref === undefined ? {} : { privacyHref: consent.privacyHref })}
        {...(consent.useSignal === undefined ? {} : { useSignal: consent.useSignal })}
      />
    );
  }

  return {
    Provider: buildProvider(config, {
      theme,
      SessionProvider: auth.SessionProvider,
      ConsentGate,
      RouteErrorBoundary,
    }),
    theme,
    SessionProvider: auth.SessionProvider,
    useSession: auth.useSession,
    emailAuth,
    lazyRoute,
    RouteErrorBoundary,
    TermsConsentGate: ConsentGate,
    brand: config.brand,
    useMessages,
    api: {
      base: apiBase,
      // Bound to `base`, because `{ base, fetch }` can only mean that. Unbound, a
      // `fetch('/consent/status')` beside a `base` of `/api` would quietly hit the
      // wrong origin path, and the package already owns the join.
      fetch: <T = unknown,>(path: string, options?: ApiFetchOptions): Promise<T> =>
        apiFetch<T>(joinApiPath(apiBase, path), options),
    },
  };
}
