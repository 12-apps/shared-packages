import { useEffect, useState, type JSX, type ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Container } from "@12-apps/ui/layout/Container";

import type { EmailAuthSettings } from "../../email-credentials/types";
import { sameOriginCallbackUrl } from "../create-web-auth";
import type { SessionStatus } from "../create-web-auth";
import { failureNotice } from "./errors";
import type { AuthErrorCopy } from "./errors";
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
  /**
   * Whether the sign-up gate is satisfied — `true` wherever there is no gate.
   *
   * The slot needs this to DISABLE its buttons. `start` already refuses while
   * the gate is unsatisfied, so nothing unsafe gets through either way, but a
   * button that looks clickable and silently does nothing is worse than one
   * that shows it is not ready. This package will not reach into a node it was
   * handed, so it says so instead.
   */
  gateSatisfied: boolean;
}

/**
 * A condition the visitor must satisfy before an account can be created.
 *
 * Terms of service, an age check, an invite code — the CONTENT is the product's
 * and the package never inspects it. What is generic is the shape: something
 * rendered above the form, a boolean the form and the provider buttons both
 * respect, and a side effect that must run BEFORE either path proceeds.
 *
 * That last part is why this is not simply a `disabled` prop. The consent stamp
 * has to happen before the OAuth handoff, not after the redirect comes back —
 * a visitor who accepts the terms and is then bounced to Google has already
 * consented, and the record of it cannot depend on them making it back.
 */
export interface AuthSignupGate {
  /** Rendered above the form, handed the state it is meant to drive. */
  render: (state: {
    satisfied: boolean;
    setSatisfied: (next: boolean) => void;
  }) => ReactNode;
  /**
   * Runs before the account is created, on BOTH paths — the e-mail form and
   * the OAuth handoff. A rejection stops the sign-up and shows
   * `failureMessage`.
   */
  onBeforeProceed?: () => Promise<void>;
  /** What to say when `onBeforeProceed` rejects. The host's words. */
  failureMessage: string;
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
  /** A condition the visitor must satisfy before signing up. */
  signupGate?: AuthSignupGate;
  /**
   * Where a REFUSED `?callbackUrl` falls back to. Defaults to the app root.
   *
   * Not the login path, which is the trap: `sameOriginCallbackUrl` returns this
   * value for an off-origin URL, and the same value is what an
   * already-authenticated visitor is redirected to. Point it at `/login` and a
   * poisoned callbackUrl sends a signed-in visitor to the login route, which
   * sees them signed in and sends them to the login route. The refusal is still
   * safe either way — nothing follows the attacker's URL — but the visitor
   * never arrives anywhere.
   */
  homePath?: string;
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
    href: config.homePath ?? "/",
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

/** The provider slot, or a spinner while the host is still discovering them. */
function providersSlot(
  config: AuthRoutesConfig,
  state: RouteState,
  gateSatisfied = true,
): ReactNode {
  if (config.providersPending === true) {
    return <LoadingState variant="spinner" size="sm" dataTestId="providers-loading" />;
  }
  return config.renderProviders?.({
    callbackUrl: state.callbackUrl,
    start: state.start,
    pending: state.pending,
    gateSatisfied,
  });
}

/** The centred spinner both routes show while the session resolves. */
function RouteSpinner({ testId }: { testId: string }): JSX.Element {
  return (
    <Container variant="centered" padding="lg">
      <LoadingState variant="spinner" size="md" dataTestId={testId} />
    </Container>
  );
}

interface RouteViewProps {
  config: AuthRoutesConfig;
  pages: AuthPages;
}

function LoginView({ config, pages }: RouteViewProps): JSX.Element {
  const state = useRouteState(config);
  const navigate = config.useNavigate();
  const emailEnabled = useEmailEnabled(config.getSettings);
  const denied = config.renderDenied?.();

  if (denied !== undefined && denied !== null) return <>{denied}</>;
  if (state.status === "loading" || state.status === "authenticated") {
    return <RouteSpinner testId="login-loading" />;
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
      providers={providersSlot(config, state)}
    />
  );
}

function SignupView({ config, pages }: RouteViewProps): JSX.Element {
  const state = useRouteState(config);
  const navigate = config.useNavigate();
  const emailEnabled = useEmailEnabled(config.getSettings);
  const gate = config.signupGate;
  const [satisfied, setSatisfied] = useState(gate === undefined);
  const [gateFailed, setGateFailed] = useState(false);

  if (state.status === "loading" || state.status === "authenticated") {
    return <RouteSpinner testId="signup-loading" />;
  }

  /**
   * The gate's side effect, then the account.
   *
   * Shared by both paths deliberately: the e-mail form calls it through
   * `onBeforeSubmit`, and the provider buttons call it before the handoff.
   * Running it in only one of the two is how consent goes unrecorded for
   * exactly the visitors who chose the other button.
   */
  const runGate = async (): Promise<void> => {
    setGateFailed(false);
    try {
      await (gate?.onBeforeProceed?.() ?? config.onBeforeSignup?.() ?? Promise.resolve());
    } catch (error) {
      setGateFailed(true);
      throw error;
    }
  };

  const notice =
    gateFailed && gate !== undefined ? (
      <Alert variant="danger" description={gate.failureMessage} data-testid="login-error" />
    ) : (
      failureNotice(state.failure, config.errors)
    );

  return (
    <pages.SignupPage
      callbackUrl={state.callbackUrl}
      onBeforeSubmit={runGate}
      onSignedIn={() => navigate(state.navigateTo, { replace: true })}
      emailEnabled={emailEnabled}
      disabled={!satisfied}
      termsGate={gate?.render({ satisfied, setSatisfied })}
      notice={notice}
      providers={providersSlot(config, {
        ...state,
        // An unsatisfied gate must stop the handoff too, not merely grey the
        // form: a provider button is a second door to the same account.
        start: (provider) => {
          if (!satisfied) return;
          void runGate()
            .then(() => state.start(provider))
            .catch(() => undefined);
        },
      }, satisfied)}
    />
  );
}

export function createAuthRoutes(config: AuthRoutesConfig): AuthRouteComponents {
  const pages = createAuthPages(config);
  return {
    LoginRoute: function LoginRoute(): JSX.Element {
      return <LoginView config={config} pages={pages} />;
    },
    SignupRoute: function SignupRoute(): JSX.Element {
      return <SignupView config={config} pages={pages} />;
    },
    pages,
  };
}
