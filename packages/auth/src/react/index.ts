/**
 * The React layer of `@12-apps/auth`.
 *
 * Separate from the root entry because the root is framework-free: a Node host
 * that only needs `createApiAuth` never pulls React in through a barrel it did
 * not ask for.
 */
export { createWebAuth, sameOriginCallbackUrl } from "./create-web-auth";
export type {
  Session,
  SessionContextValue,
  SessionStatus,
  SessionUser,
  WebAuth,
  WebAuthConfig,
} from "./create-web-auth";
