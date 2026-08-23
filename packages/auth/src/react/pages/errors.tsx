import { useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";

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

/**
 * The sentence shown for each code, plus the catch-all for one not listed.
 *
 * `titles` is the alert's HEADING, and it is optional only for compatibility:
 * a notice reads badly without one. The two hosts this replaced both had one —
 * the storefront switched between "Cadastro necessário" and "Falha ao entrar"
 * on the code, the backoffice always said the latter — and collapsing them
 * onto a description-only Alert dropped it. `titleFallback` covers every code
 * a pack does not name individually.
 */
export type AuthErrorCopy = Record<AuthErrorCode, string> & {
  fallback: string;
  /**
   * The notice's dismiss, which carries a glyph and no visible text. Required
   * because the notice is closable BY DESIGN — the code lives in the URL, so
   * without a way out it never leaves the screen.
   */
  dismiss: string;
  titles?: Partial<Record<AuthErrorCode, string>>;
  titleFallback?: string;
};

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

/** The heading for a code, if the pack names one. */
export function authErrorTitle(code: string, copy: AuthErrorCopy): string | undefined {
  return copy.titles?.[code as AuthErrorCode] ?? copy.titleFallback;
}

/**
 * The notice slot — one Alert, from one map, and DISMISSIBLE.
 *
 * Closable because the code lives in the URL: without a dismiss the notice
 * stays for as long as the visitor is on the page, including while they are
 * typing the password that will fix it. Both hosts this replaced had a close
 * button; collapsing them onto a bare Alert lost it, which is why this is a
 * component rather than a function returning one.
 */
export function FailureNotice({
  failure,
  errors,
}: {
  failure: string | null;
  errors: AuthErrorCopy;
}): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (failure === null || dismissed === failure) return null;
  const title = authErrorTitle(failure, errors);
  /*
   * The test id sits on a WRAPPER, not on the Alert.
   *
   * `Alert`'s types accept `data-testid` while its runtime reads the camelCase
   * `dataTestId`, and passing the raw attribute suppresses the close button
   * entirely — measured, and the reason this notice first shipped
   * undismissable. Rather than pick a spelling that satisfies one of the two,
   * the Alert keeps its own defaults and the id goes outside it.
   */
  return (
    <div data-testid="login-error">
      <Alert
        variant={ADVISORY_CODES.has(failure) ? "warning" : "danger"}
        {...(title === undefined ? {} : { title })}
        description={authErrorMessage(failure, errors)}
        closable
        closeLabel={errors.dismiss}
        onClose={() => setDismissed(failure)}
      />
    </div>
  );
}

