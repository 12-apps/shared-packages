import type { ComponentType, JSX, ReactNode } from "react";

import { SocialLoginContainer } from "@12-apps/ui/social-login-button";
import { Container } from "@12-apps/ui/layout/Container";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { Text } from "@12-apps/ui/typography/Text";

import type { EmailAuthScreens } from "../screens";

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
 * Everything else is here, once.
 */

/** Router-agnostic link. A host passes its own — `react-router`'s, or an `<a>`. */
export type AuthLink = ComponentType<{
  to: string;
  children: ReactNode;
  "data-testid"?: string;
  style?: Record<string, string | number>;
}>;

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
    /** "or continue with" — sits between the form and the providers. */
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
  Link: AuthLink;
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
  providers?: ReactNode;
  branding?: ReactNode;
  notice?: ReactNode;
  /**
   * Gate the whole page behind the host's own terms acceptance.
   *
   * Rendered above the form; while `accepted` is false the providers are the
   * host's to disable — this package does not reach into a node it was handed.
   */
  termsGate?: ReactNode;
}

export interface AuthPages {
  LoginPage: ComponentType<LoginPageProps>;
  SignupPage: ComponentType<SignupPageProps>;
}

/** The line under the title, when a product wants one. */
function Subtitle({ text }: { text?: string }): JSX.Element | null {
  if (!text) return null;
  return (
    <Text color="secondary" size="sm" style={{ textAlign: "center", marginBottom: "1rem" }}>
      {text}
    </Text>
  );
}

/**
 * The divider + provider block, identical on both pages.
 *
 * `label` is what the divider SAYS — "ou entre com", "ou cadastre-se com" —
 * and both sentences begin with "ou". They are only true when there is another
 * way to sign in directly above them. With the platform's e-mail method
 * switched off the form is not rendered, and the label then sits at the top of
 * the card offering an alternative to nothing: the screen reads as though a
 * form failed to load rather than as a Google-only sign-in.
 *
 * So the label is OPTIONAL, and the caller passes it only when it has rendered
 * something above. Omitted, the buttons still render — they are the whole
 * method now, not the alternative to one.
 */
function Providers({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}): JSX.Element | null {
  if (!children) return null;
  return (
    <>
      <Spacer size="lg" />
      {label !== undefined && (
        <>
          <Text color="secondary" size="sm" style={{ textAlign: "center" }}>
            {label}
          </Text>
          <Spacer size="sm" />
        </>
      )}
      {children}
    </>
  );
}

/** The footer sentence with a link to the other page. */
function Footer({
  prompt,
  linkText,
  to,
  Link,
  dataTestId,
}: {
  prompt: string;
  linkText: string;
  to: string;
  Link: AuthLink;
  dataTestId: string;
}): JSX.Element {
  return (
    <>
      <Spacer size="lg" />
      <Text color="secondary" size="sm" style={{ textAlign: "center" }}>
        {prompt}{" "}
        <Link to={to} data-testid={dataTestId} style={{ fontWeight: 600 }}>
          {linkText}
        </Link>
      </Text>
    </>
  );
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
    <Container variant="centered" padding="lg">
      {branding}
      <SocialLoginContainer title={copy.login.title} showDivider={false} maxWidth={maxWidth}>
        <Subtitle text={copy.login.subtitle} />
        {notice}
        {emailEnabled && (
          <EmailPasswordForm
            callbackUrl={callbackUrl}
            onSignedIn={onSignedIn}
            onForgotPassword={onForgotPassword}
          />
        )}
        <Providers label={emailEnabled ? copy.login.providerDivider : undefined}>{providers}</Providers>
        {routes.signup !== undefined && (
          <Footer
            prompt={copy.login.signupPrompt}
            linkText={copy.login.signupLink}
            to={routes.signup}
            Link={Link}
            dataTestId="go-to-signup"
          />
        )}
      </SocialLoginContainer>
    </Container>
  );
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
  return (
    <Container variant="centered" padding="lg">
      {branding}
      <SocialLoginContainer title={copy.signup.title} showDivider={false} maxWidth={maxWidth}>
        <Subtitle text={copy.signup.subtitle} />
        {notice}
        {termsGate}
        {emailEnabled && (
          <EmailSignupForm
            callbackUrl={callbackUrl}
            onBeforeSubmit={onBeforeSubmit}
            onSignedIn={onSignedIn}
            disabled={disabled}
          />
        )}
        <Providers label={emailEnabled ? copy.signup.providerDivider : undefined}>{providers}</Providers>
        <Footer
          prompt={copy.signup.loginPrompt}
          linkText={copy.signup.loginLink}
          to={routes.login}
          Link={Link}
          dataTestId="go-to-login"
        />
      </SocialLoginContainer>
    </Container>
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
