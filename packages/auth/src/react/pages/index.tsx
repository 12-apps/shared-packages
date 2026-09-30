import type { ComponentType, JSX, ReactNode } from "react";

import { AuthCard, AuthFooter, ProviderBlock, type AuthLink } from "./card";
import { SignupActions } from "./signup-actions";
import type { EmailAuthScreens } from "../screens";
import { RevealOnAppear } from "../screens/shared";

/**
 * `@12-apps/auth/react` — whole login and sign-up PAGES, not fragments.
 *
 * ## Why the pages and not only the forms
 *
 * `./react/screens` ships the forms, and every host then assembled the same
 * page around them: a centred container, a card, a title, the form, a "forgot
 * my password" link, a divider, the provider buttons, a footer link to the
 * other page. Two SPAs in one repository had that assembly twice, near
 * identically, each with its own private `EmailSignIn` wrapper — and a third
 * page for sign-up repeating most of it again.
 *
 * None of that layout is a product decision. What IS the product's:
 *
 * - **the words** — a copy pack, required, never defaulted;
 * - **the branding** — a slot the host fills with its own logo or store name,
 *   rendered above the title and completely opaque to this package;
 * - **the providers** — a node the host renders, because an OAuth button owns a
 *   callback URL, a consent gate and a redirect this package cannot know;
 * - **navigation** — a `Link` component and the route paths, so nothing here
 *   depends on which router the host uses.
 *
 * Everything else is here, once — this file binds the configuration and
 * decides what each page shows; `./card` is the shell they render inside.
 */

export type { AuthLink } from "./card";

/**
 * The route paths the footers link to.
 *
 * Only the two the pages actually render a link for. Forgetting a password is
 * an `onForgotPassword` callback instead, because the host has to navigate it
 * through its own router rather than a href.
 */
export interface AuthRoutes {
  login: string;
  /**
   * Where "create an account" goes — OPTIONAL.
   *
   * Absent means this deployment has no self-service sign-up, and the login
   * page then renders no footer at all rather than a link to nothing. A
   * backoffice whose accounts are provisioned by an admin is exactly that case.
   */
  signup?: string;
}

/** The page-level words. The forms carry their own pack; this is the chrome. */
export interface AuthPagesCopy {
  login: {
    title: string;
    /** A line under the title. Optional: not every product wants one. */
    subtitle?: string;
    /**
     * The word between the two ways in — "ou". It sits UNDER the providers and
     * over the form, so it must read as a plain alternative rather than as an
     * introduction to whatever follows it.
     */
    providerDivider: string;
    /** "Don't have an account?" */
    signupPrompt: string;
    /** "Sign up" — the link text after the prompt. */
    signupLink: string;
  };
  signup: {
    title: string;
    subtitle?: string;
    providerDivider: string;
    /** "Already have an account?" */
    loginPrompt: string;
    /** "Sign in" */
    loginLink: string;
  };
}

export interface AuthPagesConfig {
  /** From `createEmailAuthScreens` — the forms these pages wrap. */
  screens: EmailAuthScreens;
  copy: AuthPagesCopy;
  routes: AuthRoutes;
  /**
   * The host router's link component, for the footer that points each page at
   * the other.
   *
   * OPTIONAL, and its absence is a statement rather than an omission: a host
   * serving SEVERAL routers off one set of screens has no single `Link` to name
   * at factory time, and builds its pages per router with
   * {@link WebEmailAuth.createPages}. Without one, both footers are simply not
   * rendered — the same meaning omitting `routes.signup` already carries, and
   * the reason the alternative was refused: defaulting to a plain anchor would
   * turn the one cross-link on a sign-in page into a full page load, silently,
   * in exactly the SPA hosts this package is written for.
   */
  Link?: AuthLink;
  /**
   * How wide the card may get.
   *
   * Defaults to 460 rather than the container's own 400: 400 was chosen for a
   * card holding a row of provider buttons, and an e-mail + password pair reads
   * cramped in it.
   */
  maxWidth?: number;
}

/** What the host supplies per render, as opposed to per app. */
export interface LoginPageProps {
  /** Where to go after a successful sign-in. */
  callbackUrl: string;
  onSignedIn: () => void;
  /**
   * Navigate to the forgot-password route.
   *
   * A callback, not a route this page assigns to `window.location`: the hosts
   * are SPAs, and a full page load there throws away the router's state and the
   * app shell with it.
   */
  onForgotPassword: () => void;
  /** Is e-mail + password offered at all? Read from the platform switch. */
  emailEnabled: boolean;
  /**
   * The host's provider buttons. Rendered under the divider, untouched.
   *
   * A node rather than a description of one: an OAuth button carries a callback
   * URL, a consent gate and a redirect, none of which this package can own.
   */
  providers?: ReactNode;
  /** The host's branding slot — logo, store name, anything. Rendered on top. */
  branding?: ReactNode;
  /** Rendered above the form: the host's own error alerts, notices, banners. */
  notice?: ReactNode;
}

export interface SignupPageProps {
  /** Where to land once the account can sign in. */
  callbackUrl: string;
  /**
   * Run before the account is created — the host's consent stamp, analytics,
   * anything that must not be skipped. A rejection stops the sign-up.
   */
  onBeforeSubmit: () => Promise<void>;
  onSignedIn: () => void;
  /** Disable the form while the host's own gate is unsatisfied. */
  disabled?: boolean;
  emailEnabled: boolean;
  /**
   * The host's provider buttons. With the e-mail form they render UNDER its
   * submit, after the divider, inside the pinned action block; without it,
   * under the gate.
   *
   * With the form, that block is INSIDE the `<form>`: a button here must say
   * `type="button"` or it submits the e-mail form, and it must not bring a
   * form of its own.
   */
  providers?: ReactNode;
  branding?: ReactNode;
  notice?: ReactNode;
  /**
   * Gate the whole page behind the host's own terms acceptance.
   *
   * Rendered directly above what it enables: the form's submit when e-mail is
   * on, the provider buttons when it is off. While it is unsatisfied the
   * providers are the host's to disable — this package does not reach into a
   * node it was handed.
   *
   * With the form it is in the same block as the providers, INSIDE the
   * `<form>`: a button in the gate (a "read the terms" toggle, say) must say
   * `type="button"` or it submits the e-mail form.
   */
  termsGate?: ReactNode;
}

export interface AuthPages {
  LoginPage: ComponentType<LoginPageProps>;
  SignupPage: ComponentType<SignupPageProps>;
}

/** The config with its defaults resolved, as the two views below read it. */
interface ResolvedPagesConfig extends AuthPagesConfig {
  maxWidth: number;
}

function LoginView({
  cfg,
  callbackUrl,
  onSignedIn,
  onForgotPassword,
  emailEnabled,
  providers,
  branding,
  notice,
}: LoginPageProps & { cfg: ResolvedPagesConfig }): JSX.Element {
  const { screens, copy, routes, Link, maxWidth } = cfg;
  const { EmailPasswordForm } = screens;
  return (
    <AuthCard
      title={copy.login.title}
      {...(copy.login.subtitle === undefined ? {} : { subtitle: copy.login.subtitle })}
      {...(branding === undefined ? {} : { branding })}
      maxWidth={maxWidth}
    >
      {notice}
      <ProviderBlock label={emailEnabled ? copy.login.providerDivider : undefined}>
        {providers}
      </ProviderBlock>
      {emailEnabled && (
        <EmailPasswordForm
          callbackUrl={callbackUrl}
          onSignedIn={onSignedIn}
          onForgotPassword={onForgotPassword}
        />
      )}
      {routes.signup !== undefined && Link !== undefined && (
        <AuthFooter
          prompt={copy.login.signupPrompt}
          linkText={copy.login.signupLink}
          to={routes.signup}
          Link={Link}
          dataTestId="go-to-signup"
        />
      )}
    </AuthCard>
  );
}

/** The terms gate's test hook, on the one block it is rendered as. */
export const TERMS_GATE_TEST_ID = "signup-terms-gate";

/**
 * The host's terms gate as ONE block of whichever column it lands in.
 *
 * Both columns it can land in space their children with a `gap` (see
 * `./card`), and a gate handed over as a fragment — a checkbox, a hint, a
 * spacer — would take that gap between each of its own parts. Wrapped, it takes
 * the gap once. An absent gate renders nothing, so it leaves no gap either.
 */
function TermsGateBlock({ gate }: { gate: ReactNode }): JSX.Element | null {
  if (!present(gate)) return null;
  return <div data-testid={TERMS_GATE_TEST_ID}>{gate}</div>;
}

/** Whether a host slot has anything in it to render. */
function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

function SignupView({
  cfg,
  callbackUrl,
  onBeforeSubmit,
  onSignedIn,
  disabled,
  emailEnabled,
  providers,
  branding,
  notice,
  termsGate,
}: SignupPageProps & { cfg: ResolvedPagesConfig }): JSX.Element {
  const { screens, copy, routes, Link, maxWidth } = cfg;
  const { EmailSignupForm } = screens;
  const gate = <TermsGateBlock gate={termsGate} />;
  return (
    <AuthCard
      title={copy.signup.title}
      {...(copy.signup.subtitle === undefined ? {} : { subtitle: copy.signup.subtitle })}
      {...(branding === undefined ? {} : { branding })}
      maxWidth={maxWidth}
    >
      {/*
        The host's notice renders at the top of the card, and on this page the
        provider buttons whose failures it reports are at the bottom — so it is
        brought into view when it appears off screen, like the form's own
        refusals.
      */}
      {present(notice) && <RevealOnAppear>{notice}</RevealOnAppear>}
      {/*
        With the form, the gate and the providers go DOWN to its submit, as one
        pinned block — `SignupActions` says why. Without it there is nothing to
        come down to: the gate sits over the buttons it enables, and the card is
        short enough that nothing needs pinning.
      */}
      {emailEnabled ? (
        <EmailSignupForm
          callbackUrl={callbackUrl}
          onBeforeSubmit={onBeforeSubmit}
          onSignedIn={onSignedIn}
          disabled={disabled}
          renderActions={(submit) => (
            <SignupActions>
              {gate}
              {submit}
              <ProviderBlock label={copy.signup.providerDivider} dividerFirst>
                {providers}
              </ProviderBlock>
            </SignupActions>
          )}
        />
      ) : (
        <>
          {gate}
          <ProviderBlock>{providers}</ProviderBlock>
        </>
      )}
      {Link !== undefined && (
        <AuthFooter
          prompt={copy.signup.loginPrompt}
          linkText={copy.signup.loginLink}
          to={routes.login}
          Link={Link}
          dataTestId="go-to-login"
        />
      )}
    </AuthCard>
  );
}

/**
 * Bind one configuration to both pages.
 *
 * The markup lives at module scope rather than inside this closure. A factory
 * that also HELD both pages ran past the size budget, and it read badly for the
 * same reason it measured badly: someone chasing the login layout had to scroll
 * through the sign-up page to reach it.
 */
export function createAuthPages(config: AuthPagesConfig): AuthPages {
  const cfg: ResolvedPagesConfig = { ...config, maxWidth: config.maxWidth ?? 460 };

  function LoginPage(props: LoginPageProps): JSX.Element {
    return <LoginView cfg={cfg} {...props} />;
  }

  function SignupPage(props: SignupPageProps): JSX.Element {
    return <SignupView cfg={cfg} {...props} />;
  }

  return { LoginPage, SignupPage };
}

export { PT_BR_PAGES } from "./pt-BR";
export { PT_BR_AUTH_ERRORS } from "./pt-BR";
export { EN_US_PAGES } from "./en-US";
export { EN_US_AUTH_ERRORS } from "./en-US";
export {
  createAuthRoutes,
} from "./routes";
export { authErrorMessage, authErrorTitle, AUTH_ERROR_CODES } from "./errors";
export type { AuthErrorCode, AuthErrorCopy } from "./errors";
export type {
  AuthProvidersContext,
  AuthRouteComponents,
  AuthRoutesConfig,
  AuthRouteSession,
  AuthSignupGate,
} from "./routes";
