/**
 * The React layer of `@12-apps/auth`.
 *
 * Separate from the root entry because the root is framework-free: a Node host
 * that only needs `createApiAuth` never pulls React in through a barrel it did
 * not ask for.
 */
export { createWebAuth, sameOriginCallbackUrl } from "./create-web-auth";
export { parseSignInUrl } from "./password-signin";
export type { PasswordSignInResult } from "./password-signin";
export { createEmailAuth } from "./create-email-auth";
export type {
  AccountSecurityData,
  EmailAuth,
  EmailAuthClientResult,
  EmailAuthConfig,
  SignUpClientData,
} from "./create-email-auth";
export { useAuthAction } from "./use-auth-action";
export type { AuthAction, AuthActionState } from "./use-auth-action";
export { CREDENTIALS_PROVIDER_ID } from "../credentials-provider-id";
export type { EmailAuthFailure, EmailAuthSettings } from "../email-credentials/types";
export type {
  Session,
  SessionContextValue,
  SessionStatus,
  SessionUser,
  WebAuth,
  WebAuthConfig,
} from "./create-web-auth";
