import { useEffect, useState, type JSX, type ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Container } from "@12-apps/ui/layout/Container";

import type { EmailAuthSettings } from "../../email-credentials/types";
import { sameOriginCallbackUrl } from "../create-web-auth";
import type { SessionStatus } from "../create-web-auth";
import { createAuthPages } from "./index";
import type { AuthPages, AuthPagesConfig } from "./index";

/**
 * `createAuthRoutes` — the login and sign-up ROUTES, not only the pages.
 *
 * `createAuthPages` removed the card, the form and the footer from the hosts and
 * left them the wiring. That wiring turned out to be the larger half, and it was
 * the same in every host: read `?callbackUrl` and `?error`, redirect anybody
 * already signed in, spin while the session resolves, ask the server whether
 * e-mail sign-in is even offered, and turn an Auth.js error code into a
 * sentence.
 *
 * Two SPAs in one repository had all six, separately — 184 lines in the
 * storefront and 146 in the backoffice — and they had already DRIFTED: the same
 * `Configuration` code answered "o provedor não respondeu" in one and a
 * different sentence in the other, and one map knew nine codes while the other
 * knew four. Nothing failed. Two users simply got different explanations for
 * one event, and the map with four codes silently fell through to "erro
 * inesperado" for the five it was missing.
 *
 * A copy pack is the right place for the words. A second copy of the MAP is
 * not, which is why the codes live here and only the sentences are the host's.
 *
 * ## What is still the host's, and it is only four things
 *
 * **The router** — `useNavigate` and `useSearchParams` are passed in, so this
 * package never depends on which router a host uses.
 * **The session** — `useSession`, because a host may wrap it (a tenant, a
 * plan, an impersonation banner).
 * **The providers** — a render prop, because an OAuth button owns a callback
 * URL, a CSRF handoff and a redirect no package can know. What DOES move here
 * is the state machine around it: which button is pending, and what a failed
 * handoff shows.
 * **The words**, via the copy pack.
 */

/**
 * Every Auth.js error code these pages can receive, mapped to a copy key.
 *
 * The list is Auth.js's, not this package's, which is exactly why it belongs to
 * a package rather than to each host: a host cannot know the set, and the ones
 * that guessed got four of nine.
 */
export const AUTH_ERROR_CODES = [
  "AccessDenied",
  "Configuration",
  "Verification",
  "OAuthSignin",
  "OAuthCallback",
  "OAuthAccountNotLinked",
  "OAuthCreateAccount",
  "EmailCreateAccount",
  "Callback",
  "CredentialsSignin",
  "SessionRequired",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** The sentence shown for each code, plus the catch-all for one not listed. */
export type AuthErrorCopy = Record<AuthErrorCode, string> & { fallback: string };

/**
 * Which codes are the user's own doing rather than a fault.
 *
 * They render as a warning instead of an error: "sign up first" is an
 * instruction, and painting it red tells somebody a normal step went wrong.
 */
const ADVISORY_CODES = new Set<string>(["AccessDenied", "Verification", "SessionRequired"]);

/** The sentence for a code, falling back for anything the list does not name. */
export function authErrorMessage(code: string, copy: AuthErrorCopy): string {
  return (copy as Record<string, string>)[code] ?? copy.fallback;
}

/** Minimum this package needs from a host's session hook. */
export interface AuthRouteSession {
  status: SessionStatus;
  signIn: (provider?: string, callbackUrl?: string) => Promise<void>;
}

/** What the host's provider slot is handed. */
export interface AuthProvidersContext {
  /** The already-sanitised, base-path-prefixed URL to return to. */
  callbackUrl: string;
  /** Start an OAuth handoff. A rejection is caught and shown as a failure. */
  start: (provider: string) => void;
  /** Which provider is mid-handoff, if any. */
  pending: string | null;
}

export interface AuthRoutesConfig extends Omit<AuthPagesConfig, "screens"> {
  screens: AuthPagesConfig["screens"];
  /** The words for each Auth.js code. */
  errors: AuthErrorCopy;
  /** The host's router and session, so no router becomes a dependency here. */
  useNavigate: () => (to: string, options?: { replace?: boolean }) => void;
  useSearchParams: () => URLSearchParams;
  useSession: () => AuthRouteSession;
  /** Reads the platform switch. Usually the packaged client's `getSettings`. */
  getSettings: () => Promise<EmailAuthSettings>;
  /**
   * Prefixed onto the callback URL for a host served under a sub-path.
   *
   * The backoffice is served at `/admin`, so the URL Auth.js must return to is
   * `/admin/pedidos` while the router must be navigated to `/pedidos`. Getting
   * that pair the wrong way round sends somebody to a page that does not exist,
   * which is why both are derived here from one value.
   */
  basePath?: string;
  /** The provider buttons. Absent means this deployment offers none. */
  renderProviders?: (context: AuthProvidersContext) => ReactNode;
  /** Shown while the providers are still being discovered. */
  providersPending?: boolean;
  /** Rendered instead of the page for a session the host refuses. */
  renderDenied?: () => ReactNode;
  /** Where "forgot my password" goes. A route, or an in-place screen. */
  onForgotPassword?: (navigate: (to: string) => void) => void;
  /** Runs before an account is created — a consent stamp, analytics. */
  onBeforeSignup?: () => Promise<void>;
}

export interface AuthRouteComponents {
  /** The whole `/login` route. Takes no props. */
  LoginRoute: () => JSX.Element;
  /** The whole `/signup` route. Takes no props. */
  SignupRoute: () => JSX.Element;
  /** The pages underneath, for a host that needs to compose them itself. */
  pages: AuthPages;
}

/** Ask the server whether e-mail sign-in is offered. */
function useEmailEnabled(getSettings: () => Promise<EmailAuthSettings>): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void getSettings()
      .then((settings) => {
        if (live) setEnabled(settings.enabled);
      })
      .catch(() => {
        // A settings read that fails leaves the form hidden. The provider
        // buttons still work, so the page stays usable rather than blank.
        if (live) setEnabled(false);
      });
    return () => {
      live = false;
    };
  }, [getSettings]);
  return enabled;
}

interface RouteState {
  callbackUrl: string;
  navigateTo: string;
  failure: string | null;
  pending: string | null;
  start: (provider: string) => void;
  status: SessionStatus;
}

/** Everything both routes derive from the URL and the session. */
function useRouteState(config: AuthRoutesConfig): RouteState {
  const params = config.useSearchParams();
  const { status, signIn } = config.useSession();
  const navigate = config.useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [handoffFailed, setHandoffFailed] = useState(false);

  const base = config.basePath ?? "";
  // Sanitised against the real location, so an `?callbackUrl=` pointing at
  // another origin cannot turn a sign-in into an open redirect.
  const navigateTo = sameOriginCallbackUrl(params.get("callbackUrl") ?? undefined, {
    href: config.routes.login,
    origin: globalThis.location?.origin ?? "",
  });
  const callbackUrl = `${base}${navigateTo}`;
  const authenticated = status === "authenticated";

  useEffect(() => {
    if (authenticated) navigate(navigateTo, { replace: true });
  }, [authenticated, navigateTo, navigate]);

  return {
    callbackUrl,
    navigateTo,
    failure: handoffFailed ? "Configuration" : params.get("error"),
    pending,
    status,
    start: (provider) => {
      setPending(provider);
      setHandoffFailed(false);
      void signIn(provider, callbackUrl).catch(() => {
        // The CSRF fetch failed. Clearing the pending state matters as much as
        // the message: a button left spinning reads as "still working".
        setPending(null);
        setHandoffFailed(true);
      });
    },
  };
}

/** The notice slot — one Alert, from one map. */
function failureNotice(failure: string | null, errors: AuthErrorCopy): ReactNode {
  if (failure === null) return null;
  return (
    <Alert
      variant={ADVISORY_CODES.has(failure) ? "warning" : "danger"}
      description={authErrorMessage(failure, errors)}
      data-testid="login-error"
    />
  );
}

export function createAuthRoutes(config: AuthRoutesConfig): AuthRouteComponents {
  const pages = createAuthPages(config);

  function providersSlot(state: RouteState): ReactNode {
    if (config.providersPending === true) {
      return <LoadingState variant="spinner" size="sm" dataTestId="providers-loading" />;
    }
    return config.renderProviders?.({
      callbackUrl: state.callbackUrl,
      start: state.start,
      pending: state.pending,
    });
  }

  function LoginRoute(): JSX.Element {
    const state = useRouteState(config);
    const navigate = config.useNavigate();
    const emailEnabled = useEmailEnabled(config.getSettings);
    const denied = config.renderDenied?.();

    if (denied !== undefined && denied !== null) return <>{denied}</>;
    if (state.status === "loading" || state.status === "authenticated") {
      return (
        <Container variant="centered" padding="lg">
          <LoadingState variant="spinner" size="md" dataTestId="login-loading" />
        </Container>
      );
    }

    return (
      <pages.LoginPage
        callbackUrl={state.callbackUrl}
        onSignedIn={() => navigate(state.navigateTo, { replace: true })}
        onForgotPassword={() =>
          config.onForgotPassword?.((to) => navigate(to)) ?? navigate("/forgot-password")
        }
        emailEnabled={emailEnabled}
        notice={failureNotice(state.failure, config.errors)}
        providers={providersSlot(state)}
      />
    );
  }

  function SignupRoute(): JSX.Element {
    const state = useRouteState(config);
    const navigate = config.useNavigate();
    const emailEnabled = useEmailEnabled(config.getSettings);

    if (state.status === "loading" || state.status === "authenticated") {
      return (
        <Container variant="centered" padding="lg">
          <LoadingState variant="spinner" size="md" dataTestId="signup-loading" />
        </Container>
      );
    }

    return (
      <pages.SignupPage
        callbackUrl={state.callbackUrl}
        onBeforeSubmit={config.onBeforeSignup ?? (() => Promise.resolve())}
        onSignedIn={() => navigate(state.navigateTo, { replace: true })}
        emailEnabled={emailEnabled}
        notice={failureNotice(state.failure, config.errors)}
        providers={providersSlot(state)}
      />
    );
  }

  return { LoginRoute, SignupRoute, pages };
}
