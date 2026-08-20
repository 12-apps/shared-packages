/**
 * `@12-apps/auth/server` — the framework-neutral half of the HTTP surface.
 *
 * Route DESCRIPTORS and the refusal vocabulary, with no framework imported. A
 * host on Hono mounts `@12-apps/auth/hono`; a host on anything else adapts
 * these directly and never resolves Hono at all.
 */
export { emailAuthRoutes } from "./email-routes";
export type {
  EmailAuthRoute,
  EmailAuthRequest,
  EmailAuthResponse,
  EmailAuthRoutesConfig,
} from "./email-routes";

export { EMAIL_AUTH_STATUS, PT_BR_MESSAGES } from "./messages";
export type { EmailAuthMessages } from "./messages";

export { emailAuthSettingsRoutes } from "./settings-routes";
export type {
  EmailAuthSettingsStore,
  EmailAuthSettingsRoutesConfig,
} from "./settings-routes";

export { PT_BR_MAIL, renderAuthMail } from "./mail-templates";
export type { MailCopy, MailPack, RenderedMail } from "./mail-templates";

/**
 * The Prisma-shaped store seam.
 *
 * Here rather than on a `./prisma` subpath because it is the same kind of thing
 * report-builder keeps in `./server`: a seam over a DUCK-TYPED client, with no
 * dependency on a generated Prisma package. A host implementing the seam itself
 * imports these types and installs nothing extra.
 */
export * from "../prisma";

/**
 * The Auth.js bridge — the runtime-bound half, here for the same reason
 * report-builder keeps `createReportBuilder` in `./server`.
 *
 * `createApiAuth` is the sanctioned way to adopt this package: one factory, one
 * config object. `handlers`, `auth`, `authConfig` and the two setters are the
 * legacy module-global surface it replaces; they delegate to the same builder,
 * so the two cannot disagree about what a session is.
 *
 * All of it value-imports `@auth/core`, which is precisely why none of it is in
 * the package root any more.
 */
export { auth, authConfig, authHandler, handlers } from "./auth-handler";

export { createApiAuth } from "../create-api-auth";
export type { ApiAuth, ApiAuthConfig } from "../create-api-auth";

export { credentialsProvider } from "../credentials-provider";
export type { CredentialsProviderConfig } from "../credentials-provider";

export { setSignInGate, setSessionAdminResolver } from "../config";
export type { ExtendedSession, SignInGate, SessionAdminResolver } from "../config";

/** Auth.js types, re-exported so a host need not depend on `@auth/core` itself. */
export type { AuthConfig } from "@auth/core";
export type { DefaultSession, Session, User } from "@auth/core/types";

/**
 * The NODE-BOUND half of the flow.
 *
 * `createEmailCredentials`, the password policy and the token primitives all
 * reach `node:crypto`, so none of them can sit on a root that a browser bundle
 * value-imports. Here they cost a browser nothing and a server nothing extra —
 * a host already importing `./server` for the routes has them in hand.
 *
 * The matching TYPES are exported from the root as well, deliberately: they are
 * erased, and an SPA naming a refusal should not have to reach for a server
 * entry point to do it.
 */
export { createEmailCredentials } from "../email-credentials";
export {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  hashPassword,
  isPasswordAcceptable,
  needsRehash,
  verifyPassword,
} from "../password";
export {
  DEFAULT_TOKEN_TTL_MS,
  buildTokenLink,
  hashToken,
  isTokenExpired,
  issueToken,
} from "../tokens";
