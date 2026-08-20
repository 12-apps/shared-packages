/**
 * `@12-apps/auth` — the package root, and deliberately the LIGHT half.
 *
 * Nothing here value-imports a runtime. Everything in this file is pure: the
 * e-mail + password flow, the password policy, the token primitives, the admin
 * allowlist, the rate limiter and device detection. A background job that
 * expires stale tokens can import `hashToken` from here and load nothing else.
 *
 * That is report-builder's split, and the reason for it: its `.` is the spec
 * engine and its `./server` is the runtime-bound half. The Auth.js bridge —
 * `authHandler`, `handlers`, `auth`, `authConfig`, `createApiAuth`,
 * `credentialsProvider` — therefore lives in `@12-apps/auth/server`. It
 * value-imports `@auth/core` AND applies the `AUTH_*` environment defaults as a
 * module side effect, neither of which belongs behind an import of the root.
 */

/**
 * The e-mail + password flow.
 *
 * `createEmailCredentials` is sign up, verify, forget, reset, and setting a
 * password on an account that only had Google. It is pure: the Auth.js bridge
 * that turns it into a provider is `credentialsProvider`, in `./server`.
 */
export { createEmailCredentials } from "./email-credentials";
export type { EmailCredentials } from "./email-credentials";
export type {
  AcknowledgeResult,
  AuthEmailMessage,
  AuthRateLimiter,
  AuthTokenPurpose,
  AuthenticateInput,
  AuthenticateResult,
  EmailAuthFailure,
  EmailAuthRefusal,
  EmailAuthSettings,
  EmailAuthSettingsResolver,
  EmailCredentialUser,
  EmailCredentialsConfig,
  EmailCredentialsMailer,
  EmailCredentialsStore,
  SignUpInput,
  SignUpResult,
  StoredAuthToken,
} from "./email-credentials";

/**
 * The provider's id, on its own module so naming it costs no runtime.
 *
 * A browser comparing `session.provider` needs this string and must not pull
 * `@auth/core` in to get it — which is why it has never lived beside
 * `credentialsProvider` itself.
 */
export { CREDENTIALS_PROVIDER_ID } from "./credentials-provider-id";

/** Password policy and hashing. */
export {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  hashPassword,
  isPasswordAcceptable,
  needsRehash,
  verifyPassword,
} from "./password";
export type { PasswordPolicy, PasswordPolicyViolation } from "./password";

/** Single-use token primitives. */
export {
  DEFAULT_TOKEN_TTL_MS,
  buildTokenLink,
  hashToken,
  isTokenExpired,
  issueToken,
} from "./tokens";
export type { IssuedToken, IssueTokenOptions } from "./tokens";

/** Admin allowlist helpers. */
export { isAdminEmail, parseAdminEmails } from "./admin";

/** The in-process rate limiter every host of this flow ends up writing. */
export {
  createInProcessRateLimiter,
  DEFAULT_RATE_LIMITS,
  type InProcessRateLimiterConfig,
} from "./rate-limit";

/**
 * Device detection.
 *
 * Here rather than on a subpath of its own: it is pure, with no peer and no
 * runtime, and an export marks a PEER boundary in this package — never merely a
 * module.
 */
export * from "./device-detection";
