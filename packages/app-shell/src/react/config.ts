/**
 * WHAT A BROWSER HOST STATES — the shell's config and the shell it gets back.
 *
 * Types only, and split out of `./create-web-app-shell` for a reason worth
 * writing down: these five declarations carry most of this surface's DOCTRINE
 * (why `consent` has no default, why `formatters` is required, why `messages`
 * takes a resolver and `useLocale` a hook), and that prose is what pushed the
 * factory over the complexity gate's 400-line limit. A type module erases
 * completely at build, so moving them costs the emitted bundle nothing and
 * changes no module's evaluation order — which the module that runs beside them
 * could not have said.
 *
 * `./create-web-app-shell` re-exports every name here, so the import path every
 * adopter already writes is unchanged.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import type { EmailAuth, SessionContextValue } from '@12-apps/auth/react';
import type { Theme } from '@12-apps/ui/mui/styles';

import type { ApiFetchOptions } from '../core/api';
import type { AppShellCopySource } from '../core/copy';

import type { ConsentSignalHook } from './consent/terms-consent-dialog';
import type { lazyRoute } from './lazy-route';
import type { AppShellLocaleHook, AppShellMessages } from './messages';
import type { createShellRouteErrorBoundary, RouteCrashReporter } from './route-error-boundary';
import type { AppThemeOptions, ThemeMode } from './theme';

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
  /**
   * Every string the shell renders — REQUIRED host words, or a RESOLVER that
   * picks a pack per reader (`localeCopy(MY_SHELL_MESSAGES)`).
   *
   * The resolver is what makes the shell's chrome follow whoever has the app
   * open, and it is only worth anything alongside {@link WebAppShellConfig.useLocale}:
   * a source with nothing to tell it a tag resolves to the same words forever.
   */
  messages: AppShellCopySource<AppShellMessages>;
  /**
   * Which language the shell reads in — the host's own hook, called inside the
   * renders that show a sentence.
   *
   * A hook rather than a value because the shell is built ONCE, at module scope
   * (it has to be: the boundary and the session context are component types). A
   * tag passed here would be the tag that was true at import, which is the
   * frozen language this field exists to unfreeze. A host on `@12-apps/i18n`
   * passes `useLocale`; a host with one audience passes nothing.
   */
  useLocale?: AppShellLocaleHook;
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
  /**
   * The shell's strings for the CURRENT reader, so a host renders the same
   * sentences elsewhere in the same language.
   *
   * A hook, and it replaces the resolved `messages` table that used to sit
   * here. That table was read once when the shell was built, so a host
   * rendering "Recarregar" beside the shell's own would have kept rendering it
   * after the reader switched — one screen, two languages, and only the half
   * outside the package wrong.
   */
  useMessages: () => AppShellMessages;
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
