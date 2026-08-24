import type { ComponentType, JSX, ReactNode } from "react";

import { ScreensProvider, type EmailAuthScreensConfig } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { EmailPasswordForm } from "./email-password-form";
import { EmailSignupForm, type SignupConfig } from "./email-signup-form";
import { ForgotPasswordScreen } from "./forgot-password";
import { PasswordField } from "./password-field";
import { ResetPasswordScreen } from "./reset-password";
import { PasswordSecurityCard } from "./security-card";
import { FailureBanner, LinkButton } from "./shared";
import { VerifyEmailScreen } from "./verify-email";

/**
 * The e-mail + password SCREENS, as one factory.
 *
 * The same shape as everything else in this package: one call, one config
 * object, nothing global. `createEmailCredentials` is the server half,
 * `createEmailAuth` the browser client, and this is what a person looks at.
 *
 * ## Why a factory and not nine exported components
 *
 * Every screen needs the same three things — the client, the copy, and the
 * host's sign-in — and none of them can be a module-level import without
 * welding the screens to one host. That is exactly what the previous version
 * did: the components imported the app's own `emailAuth` singleton and a file
 * of Portuguese sentences, which made them unusable anywhere else. Handing the
 * three in once, here, is what makes them portable.
 *
 * ```tsx
 * const auth = createWebAuth({ basePath: "/api/auth" });
 * const client = createEmailAuth({ basePath: "/api/auth/email" });
 * export const screens = createEmailAuthScreens({
 *   client,
 *   copy: PT_BR,          // your words — the package ships none
 *   useSession: auth.useSession,
 * });
 * ```
 *
 * The components are bound at factory time, so a host renders
 * `screens.ForgotPasswordScreen` and never passes config again.
 */
export interface EmailAuthScreens {
  /** Sign in. Render above the social buttons on a login screen. */
  EmailPasswordForm: ComponentType<{
    callbackUrl: string;
    onSignedIn: () => void;
    onForgotPassword: () => void;
  }>;
  /** Create an account. Both success shapes handled; see the component. */
  EmailSignupForm: ComponentType<SignupConfig>;
  /** "I forgot my password" — asks for a reset link. */
  ForgotPasswordScreen: ComponentType<{ onBackToLogin: () => void }>;
  /** The page the reset link opens. */
  ResetPasswordScreen: ComponentType<{
    token: string | null;
    onDone: () => void;
    onRequestNewLink: () => void;
  }>;
  /** The page the confirmation link opens. */
  VerifyEmailScreen: ComponentType<{ token: string | null; onContinue: () => void }>;
  /** Add or change a password for the signed-in account. */
  PasswordSecurityCard: ComponentType<Record<string, never>>;
  /** A password input with a show/hide toggle, for a host's own forms. */
  PasswordField: ComponentType<{
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoComplete: "current-password" | "new-password";
    error?: boolean;
    helperText?: string;
    dataTestId: string;
    autoFocus?: boolean;
  }>;
  /** The refusal banner these screens use, for a host's own forms. */
  FailureBanner: ComponentType<{
    title: string;
    reason: EmailAuthScreenReason | null;
    violations?: readonly string[] | null;
    onDismiss: () => void;
  }>;
  /** A button that reads as a link. Unbound — it needs no config. */
  LinkButton: ComponentType<{
    onClick: () => void;
    dataTestId: string;
    children: ReactNode;
  }>;
}

export function createEmailAuthScreens(config: EmailAuthScreensConfig): EmailAuthScreens {
  /**
   * Wrap one component so it renders inside the provider.
   *
   * Per component rather than once around the host's tree, because a host must
   * be able to drop `PasswordSecurityCard` into a settings page it did not
   * build. Nesting providers is free, and the alternative — asking every host
   * to mount one — is a setup step whose omission fails at render.
   */
  function bind<P extends object>(Component: ComponentType<P>): ComponentType<P> {
    function Bound(props: P): JSX.Element {
      return (
        <ScreensProvider value={config}>
          <Component {...props} />
        </ScreensProvider>
      );
    }
    Bound.displayName = `EmailAuth(${Component.displayName ?? Component.name})`;
    return Bound;
  }

  return {
    EmailPasswordForm: bind(EmailPasswordForm),
    EmailSignupForm: bind(EmailSignupForm),
    ForgotPasswordScreen: bind(ForgotPasswordScreen),
    ResetPasswordScreen: bind(ResetPasswordScreen),
    VerifyEmailScreen: bind(VerifyEmailScreen),
    PasswordSecurityCard: bind(PasswordSecurityCard),
    PasswordField: bind(PasswordField),
    FailureBanner: bind(FailureBanner),
    LinkButton,
  };
}

export type { EmailAuthScreensConfig, ScreensSession } from "./context";
export type { EmailAuthCopy, EmailAuthScreenReason } from "./copy";
/** A ready pt-BR pack, still passed by name. See the file for why that is not a default. */
export { PT_BR } from "./pt-BR";
export { EN_US } from "./en-US";
export { failureMessage } from "./copy";
export type { SignupConfig } from "./email-signup-form";
