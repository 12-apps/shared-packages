/**
 * The one thing this package exposes to a FRONTEND host (12-18).
 *
 * What used to be `future-pay/packages/spa-shared` — a PRIVATE workspace package no
 * other app could install — assembled into one factory. Three SPAs each repeated the
 * same provider tower by hand: a query client, a theme, `CssBaseline`, a session
 * provider, the consent gate, then a router. The tower is not interesting and it is
 * not the host's business, but every line of it was in the host.
 *
 * ```tsx
 * const shell = createWebAppShell({
 *   brand: { name: 'Paladira' },
 *   onCrash: reportRouteCrash,
 *   queryClient,
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
 * ## Required, because the alternative fails OPEN
 *
 *  - `brand.name` — a package-supplied product name would put someone else's brand
 *    on a host's screens.
 *  - `onCrash` — see `route-error-boundary.ts`: the boundary's own default reports
 *    past the host's noise rules, so a crashed page can file an issue for a 404.
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
import { createWebAuth, type SessionContextValue } from '@12-apps/auth/react';

import { apiFetch, type ApiFetchOptions } from '../core/api';
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

/** The consent gate's wiring. Omit the whole object and no gate is mounted. */
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
  consent?: ShellConsentConfig;
  messages?: Partial<AppShellMessages>;
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
  /** The whole provider tower, in one component. */
  Provider: (props: ShellProviderProps) => JSX.Element;
  /** The MUI theme the Provider installs, for a host that needs it directly. */
  theme: Theme;
  /** Read the session; throws outside `Provider`. */
  useSession: () => SessionContextValue;
  /** `React.lazy` with the stale-chunk recovery. Use it for every routed page. */
  lazyRoute: typeof lazyRoute;
  /** The boundary configured with this shell's fallback and reporter. */
  RouteErrorBoundary: ReturnType<typeof createShellRouteErrorBoundary>;
  /** The consent gate alone, for a host composing its tree by hand. */
  TermsConsentGate: () => JSX.Element | null;
  brand: ShellBrand;
  /** The resolved messages table, so a host renders the same strings elsewhere. */
  messages: AppShellMessages;
  api: {
    /** Where the surface is mounted, resolved. */
    base: string;
    /** {@link apiFetch}, for a host's own calls. */
    fetch: <T = unknown>(path: string, options?: ApiFetchOptions) => Promise<T>;
  };
}

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
  },
): (props: ShellProviderProps) => JSX.Element {
  const { SessionProvider, ConsentGate, theme } = parts;

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
        <SessionProvider>{inner}</SessionProvider>
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
  const auth = createWebAuth(
    config.authBasePath === undefined ? {} : { basePath: config.authBasePath },
  );
  // Built ONCE, at factory time: a boundary rebuilt per render is a new component
  // type each time, so React would remount everything below it on every parent
  // render.
  const RouteErrorBoundary = createShellRouteErrorBoundary({
    onCrash: config.onCrash,
    ...(config.messages ? { messages: config.messages } : {}),
  });

  const consent = config.consent;
  function ConsentGate(): JSX.Element | null {
    // No `consent` config means the host declares it has no terms flow. Mounting a
    // gate that polls an endpoint nobody implemented would be the noisier failure.
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
    }),
    theme,
    useSession: auth.useSession,
    lazyRoute,
    RouteErrorBoundary,
    TermsConsentGate: ConsentGate,
    brand: config.brand,
    messages,
    api: { base: apiBase, fetch: apiFetch },
  };
}
