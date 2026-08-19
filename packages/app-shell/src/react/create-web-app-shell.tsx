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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { CssBaseline } from '@12-apps/ui/mui/CssBaseline';
import { ThemeProvider } from '@12-apps/ui/mui/styles';
import type { Theme } from '@12-apps/ui/mui/styles';
import {
  createEmailAuth,
  createWebAuth,
  type EmailAuth,
  type SessionContextValue,
} from '@12-apps/auth/react';

import { apiFetch, type ApiFetchOptions } from '../core/api';
import { joinApiPath } from '../core/paths';
import { TermsConsentDialog, type ConsentSignalHook } from './consent/terms-consent-dialog';
import { lazyRoute } from './lazy-route';
import { messagesOf, type AppShellMessages } from './messages';
import { createShellRouteErrorBoundary, type RouteCrashReporter } from './route-error-boundary';
import { createAppTheme, type AppThemeOptions, type ThemeMode } from './theme';

/** The product's own identity — the single source for its user-visible name. */
export interface ShellBrand {
  /**
   * The user-visible product name. REQUIRED: anything rendering the platform's own
   * name reads it from here instead of repeating the literal, so a rebrand is one
   * line — and a default would be a different product's brand.
   *
   * Three kinds of place CANNOT import it and must be kept in sync by hand on a
   * rebrand: a SPA's static `index.html` `<title>`, a service worker's push
   * fallback title, and any lowercase protocol identifier (an MCP server id), which
   * is deliberately not display text.
   */
  name: string;
}

/** The consent gate's wiring. Pass `false` instead and no gate is mounted. */
export interface ShellConsentConfig {
  termsHref?: string;
  privacyHref?: string;
  /** The realtime accelerator. See {@link ConsentSignalHook}. */
  useSignal?: ConsentSignalHook;
}

export interface WebAppShellConfig {
  /** Where `createApiAppShell` is mounted. Defaults to `/api`. */
  apiBase?: string;
  brand: ShellBrand;
  /** Colour scheme and the tenant's white-label seed. */
  theme?: AppThemeOptions & { mode?: ThemeMode };
  /** Where a caught render crash is reported. REQUIRED. */
  onCrash: RouteCrashReporter;
  /** The host's react-query client. Omit and no `QueryClientProvider` is mounted. */
  queryClient?: QueryClient;
  /** Where the auth endpoints live. Passed straight to `createWebAuth`. */
  authBasePath?: string;
  /**
   * Where the host mounted the e-mail + password endpoints. Defaults to
   * `{authBasePath}/email`, which is where `createEmailAuth` looks.
   *
   * Only the PATH is configurable, never whether the surface exists: the shell
   * always exposes {@link WebAppShell.emailAuth}, and a deployment that has the
   * method switched off says so through `emailAuth.getSettings()` rather than
   * by the client not being there. A screen that had to branch on the client's
   * existence could not render "e-mail sign-in is unavailable" at all.
   */
  emailAuthBasePath?: string;
  /**
   * The consent gate's wiring, or `false` to declare that this app has no terms flow.
   *
   * REQUIRED, and required in order to be SYMMETRIC with the server half, where
   * `isCurrent` has no default for the same reason (`server/config.ts`). The mounted
   * gate is what TELLS a user their acceptance went stale; a host that mounts
   * `createApiAppShell` and forgets this key gets the original dead end back — its
   * guards refuse and nothing on screen ever asks — and nothing fails loudly enough to
   * find it. `false` is one word and it is a statement; silence was a guess.
   */
  consent: ShellConsentConfig | false;
  messages: AppShellMessages;
}

/** Props for the shell's provider tower. */
export interface ShellProviderProps {
  /**
   * Wrap everything BELOW the session and ABOVE the consent gate.
   *
   * This is the slot a host's own app-wide providers go in — a realtime provider, an
   * impersonation banner. It has to be below the session (they read it) and above
   * the gate (the gate's `useSignal` reads the realtime context), which is a
   * two-sided constraint no single "children" slot can express.
   */
  wrap?: (inner: ReactNode) => ReactNode;
  /** Mount a `BrowserRouter` around `children`. Omit if the host brings its own. */
  router?: { basename?: string };
  /** The routed application. */
  children?: ReactNode;
}

export interface WebAppShell {
  /** The whole provider tower, in one component — boundary included. */
  Provider: (props: ShellProviderProps) => JSX.Element;
  /** The MUI theme the Provider installs, for a host that needs it directly. */
  theme: Theme;
  /**
   * The session ALONE, for a tree that needs one without the rest of the tower.
   *
   * `Provider` is the whole thing — boundary, theme, session, consent gate,
   * router — which is right for an application entry point and wrong for
   * everything else. A unit test rendering one signed-in component, a Storybook
   * story, a fixture: each needs the session, and none of them wants a consent
   * gate reaching for the terms endpoint or a `BrowserRouter` fighting the one
   * the harness already mounted.
   *
   * Without this a host cannot get there, and cannot work around it either:
   * `useSession` reads the context THIS mount created, so a host that calls
   * `createWebAuth()` itself has a second context, and a component renders under
   * one provider while reading from the other. What that looks like is
   * `useSession must be used within a SessionProvider`, thrown from a tree that
   * visibly has one — which is a bad hour for whoever is holding it.
   *
   * Same instance `Provider` mounts, so a component behaves identically under
   * either.
   */
  SessionProvider: (props: { children: ReactNode }) => JSX.Element;
  /** Read the session; throws outside `Provider` or {@link WebAppShell.SessionProvider}. */
  useSession: () => SessionContextValue;
  /**
   * The e-mail + password flow: sign up, verify, forget, reset, and add a
   * password to an account that only had a social provider.
   *
   * Here rather than left to each host for the same reason `useSession` is. It
   * is the same base path, the same cookies and the same session that
   * `signInWithPassword` refreshes — a host building its own `createEmailAuth`
   * would be free to point it somewhere else, and the failure would show up as
   * a 404 on a screen nobody tests until someone forgets their password.
   */
  emailAuth: EmailAuth;
  /** `React.lazy` with the stale-chunk recovery. Use it for every routed page. */
  lazyRoute: typeof lazyRoute;
  /**
   * The boundary configured with this shell's fallback and reporter.
   *
   * `Provider` already mounts this one around everything, so a host needs it only for
   * FINER placement — below its own chrome, so a crashed page keeps the sidebar. That
   * is additive: React hands the error to the nearest boundary, so the inner one
   * catches, the outer never sees it, and `onCrash` fires once.
   */
  RouteErrorBoundary: ReturnType<typeof createShellRouteErrorBoundary>;
  /** The consent gate alone, for a host composing its tree by hand. */
  TermsConsentGate: () => JSX.Element | null;
  brand: ShellBrand;
  /** The resolved messages table, so a host renders the same strings elsewhere. */
  messages: AppShellMessages;
  api: {
    /** Where the surface is mounted, resolved. */
    base: string;
    /**
     * {@link apiFetch}, for a host's own calls — BOUND to {@link WebAppShell.api.base}.
     *
     * `fetch('/consent/status')` therefore hits `${base}/consent/status`, which is the
     * only reading a `base` sitting beside it can honestly have. Joined with
     * `joinApiPath`, so neither a trailing slash on the base nor a missing leading slash
     * on the path doubles or drops one.
     */
    fetch: <T = unknown>(path: string, options?: ApiFetchOptions) => Promise<T>;
  };
}

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

/** Build the browser shell. One call, one config object. */
export function createWebAppShell(config: WebAppShellConfig): WebAppShell {
  const apiBase = config.apiBase ?? '/api';
  const messages = messagesOf(config.messages);
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
    // Passed straight through: `messages` is required on both configs now, so
    // there is no "absent" case left to spread around.
    messages: config.messages,
  });

  const consent = config.consent;
  function ConsentGate(): JSX.Element | null {
    // `consent: false` is the host DECLARING it has no terms flow. Mounting a gate
    // that polls an endpoint nobody implemented would be the noisier failure.
    if (!consent) return null;
    return (
      <TermsConsentDialog
        apiBase={apiBase}
        messages={messages}
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
    messages,
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
