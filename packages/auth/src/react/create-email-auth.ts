import type {
  EmailAuthFailure,
  EmailAuthSettings,
} from "../email-credentials/types";

/**
 * The browser half of the e-mail flow: sign up, forget, reset, verify, and add
 * a password to an account that only had Google.
 *
 * One factory, one config object — the same shape as `createApiAuth`,
 * `createWebAuth` and `createEmailCredentials`, so a host wires four things the
 * same way instead of four ways.
 *
 * ## The wire contract
 *
 * These are the host's own endpoints, not Auth.js's, so this file states what
 * they must answer with:
 *
 * - **success** → `2xx` with `{ "data": … }`
 * - **refusal** → non-2xx with `{ "error": "…", "reason": "<EmailAuthFailure>" }`
 *
 * `reason` is the load-bearing half. It is the same closed vocabulary the
 * backend flow returns, so the screen can say "that link has expired" rather
 * than "something went wrong" — and because it is a code rather than a
 * sentence, the copy stays in the host's language and never in this package.
 *
 * A refusal WITHOUT a usable `reason` — a proxy's HTML error page, a 502 —
 * collapses to `unknown`, which every screen must have copy for. Assuming a
 * well-formed body is how a maintenance window turns into a blank error box.
 */

/** What any of these calls produced. Never throws for an ordinary refusal. */
export type EmailAuthClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: EmailAuthFailure | "unknown"; violations?: readonly string[] };

/** What `signUp` reports back — see `SignUpResult` for what the two mean. */
export interface SignUpClientData {
  status: "verification-sent" | "signed-up";
}

/** The signed-in account's credential state, for the security screen. */
export interface AccountSecurityData {
  hasPassword: boolean;
  emailVerified: boolean;
}

export interface EmailAuthConfig {
  /**
   * Where the host mounted the e-mail endpoints. Defaults to `/api/auth/email`.
   *
   * Under `/api/auth` on purpose: that prefix is already the auth surface, so a
   * host's route-coverage and exclusion rules treat these the same way they
   * treat the Auth.js handshake instead of needing a new carve-out.
   */
  basePath?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface EmailAuth {
  /** Which sign-in methods this deployment offers, for the login screen. */
  getSettings(): Promise<EmailAuthClientResult<EmailAuthSettings>>;
  signUp(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<EmailAuthClientResult<SignUpClientData>>;
  verifyEmail(token: string): Promise<EmailAuthClientResult<null>>;
  resendVerification(email: string): Promise<EmailAuthClientResult<null>>;
  requestPasswordReset(email: string): Promise<EmailAuthClientResult<null>>;
  resetPassword(input: {
    token: string;
    password: string;
  }): Promise<EmailAuthClientResult<null>>;
  /** Signed-in: change the password, or set the first one on a social account. */
  setPassword(input: {
    password: string;
    currentPassword?: string;
  }): Promise<EmailAuthClientResult<null>>;
  /** Signed-in: which of "add" or "change" the security screen should offer. */
  getSecurity(): Promise<EmailAuthClientResult<AccountSecurityData>>;
}

/** The refusal vocabulary, as strings, for narrowing an untrusted body. */
const FAILURES: readonly string[] = [
  "method-disabled",
  "invalid-email",
  "weak-password",
  "email-taken",
  "invalid-credentials",
  "email-not-verified",
  "token-invalid",
  "rate-limited",
  "current-password-required",
  "current-password-invalid",
  "no-account",
];

interface ErrorBody {
  error?: unknown;
  reason?: unknown;
  violations?: unknown;
}

/** Narrow a refusal body to the closed vocabulary, or `unknown`. */
function toRefusal<T>(body: ErrorBody | null): EmailAuthClientResult<T> {
  const reason =
    typeof body?.reason === "string" && FAILURES.includes(body.reason)
      ? (body.reason as EmailAuthFailure)
      : "unknown";
  const violations = Array.isArray(body?.violations)
    ? body.violations.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return violations ? { ok: false, reason, violations } : { ok: false, reason };
}

/** Build the browser e-mail-flow client. One call, one config object. */
export function createEmailAuth(config: EmailAuthConfig = {}): EmailAuth {
  const basePath = config.basePath ?? "/api/auth/email";
  const doFetch: typeof fetch = config.fetchImpl ?? ((...args) => fetch(...args));

  async function call<T>(
    path: string,
    init: { method: "GET" | "POST" | "PUT"; body?: unknown },
  ): Promise<EmailAuthClientResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${basePath}${path}`, {
        method: init.method,
        // The signed-in calls (`setPassword`, `getSecurity`) need the session
        // cookie, and the anonymous ones need the CSRF cookie the host sets.
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      // The network never answered. Indistinguishable from a 502 to the person
      // looking at the screen, so it gets the same code.
      return { ok: false, reason: "unknown" };
    }

    const body = (await response.json().catch(() => null)) as
      | (ErrorBody & { data?: T })
      | null;
    if (!response.ok) return toRefusal<T>(body);
    return { ok: true, data: (body?.data ?? null) as T };
  }

  return {
    getSettings: () => call<EmailAuthSettings>("/settings", { method: "GET" }),
    signUp: (input) => call<SignUpClientData>("/signup", { method: "POST", body: input }),
    verifyEmail: (token) => call<null>("/verify", { method: "POST", body: { token } }),
    resendVerification: (email) =>
      call<null>("/resend-verification", { method: "POST", body: { email } }),
    requestPasswordReset: (email) =>
      call<null>("/forgot-password", { method: "POST", body: { email } }),
    resetPassword: (input) => call<null>("/reset-password", { method: "POST", body: input }),
    setPassword: (input) => call<null>("/password", { method: "PUT", body: input }),
    getSecurity: () => call<AccountSecurityData>("/password", { method: "GET" }),
  };
}
