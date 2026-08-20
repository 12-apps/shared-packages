import type { ReactNode } from "react";

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

/** The notice slot — one Alert, from one map. */
export function failureNotice(failure: string | null, errors: AuthErrorCopy): ReactNode {
  if (failure === null) return null;
  return (
    <Alert
      variant={ADVISORY_CODES.has(failure) ? "warning" : "danger"}
      description={authErrorMessage(failure, errors)}
      data-testid="login-error"
    />
  );
}

