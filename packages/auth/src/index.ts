/**
 * `@12-apps/auth` — the package root, and the ISOMORPHIC half.
 *
 * Every value here runs in a browser as happily as in Node. That is a stricter
 * rule than "pulls no peer", and the stricter one is the one that matters:
 * `@12-apps/app-shell` value-imports this root from a browser bundle to get
 * `detectAppleDevice`, so anything reachable from here is in an SPA's bundle
 * whether that SPA wanted it or not.
 *
 * A NODE BUILTIN binds a runtime just as firmly as a peer does, and it is the
 * one a bundler cannot shim: `node:crypto` is externalised for the browser, and
 * Rollup then fails on `scrypt` rather than degrading. So the password policy,
 * the token primitives and `createEmailCredentials` — all three reach
 * `node:crypto` — live in `@12-apps/auth/server`, beside the Auth.js bridge.
 *
 * Their TYPES stay here. `export type` is erased, so it costs a browser nothing,
 * and an SPA typing a response off this flow should not have to import a server
 * entry point to name what it is holding.
 */

/** The e-mail + password flow's vocabulary. Types only — the flow is in `./server`. */
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
export type { PasswordPolicy, PasswordPolicyViolation } from "./password";
export type { IssuedToken, IssueTokenOptions } from "./tokens";

/**
 * The provider's id, on its own module so naming it costs no runtime.
 *
 * A browser comparing `session.provider` needs this string and must not pull
 * `@auth/core` in to get it.
 */
export { CREDENTIALS_PROVIDER_ID } from "./credentials-provider-id";

/** Admin allowlist helpers. Plain string work. */
export { isAdminEmail, parseAdminEmails } from "./admin";

/** The in-process rate limiter every host of this flow ends up writing. */
export {
  createInProcessRateLimiter,
  DEFAULT_RATE_LIMITS,
  type InProcessRateLimiterConfig,
} from "./rate-limit";

/** Device detection — the reason this root has to stay browser-safe. */
export * from "./device-detection";

export {
  AUTH_ACCESS,
  AUTH_ERRORS,
  AUTH_MAIL,
  AUTH_MESSAGES,
  AUTH_PAGES,
  AUTH_SCREENS,
  AUTH_SETTINGS,
} from "./locales";
