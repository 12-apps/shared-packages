import NextAuth from "next-auth";
import type { Session, User, NextAuthConfig } from "next-auth";
import { authConfig } from "./config";
import { isAdminEmail, parseAdminEmails } from "./admin";

/**
 * Create the NextAuth instance from the (separately importable) config.
 */
const nextAuth = NextAuth(authConfig);

/**
 * Export NextAuth handlers and utilities
 */
export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
export const auth = nextAuth.auth;

/**
 * Re-export the config (and its `ExtendedSession` type) so consumers can reach
 * it from the package root, while `@repo/auth/config` stays importable without
 * constructing the NextAuth instance (tests / edge).
 */
export { authConfig };
export { setSignInGate, setSessionAdminResolver } from "./config";
export type { ExtendedSession, SignInGate, SessionAdminResolver } from "./config";

/**
 * Admin allowlist helpers (also available via `@repo/auth/admin` for
 * dependency-free contexts such as Edge middleware and unit tests).
 */
export { isAdminEmail, parseAdminEmails };

/**
 * Type exports for consumers
 */
export type { Session, User, NextAuthConfig };
