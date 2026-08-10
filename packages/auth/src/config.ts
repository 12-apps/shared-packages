import type { AuthConfig } from "@auth/core";

import { buildAuthConfig, getEnv } from "./build-config";
import type { SessionAdminResolver, SignInGate } from "./build-config";

/**
 * The legacy module-level config, kept for hosts pinned to a version that
 * predates {@link createApiAuth}.
 *
 * **New code should use `createApiAuth({ … })` instead.** This surface has three
 * things to wire rather than one, and two of them are mutable module globals any
 * importer can overwrite — which is exactly what the porting rule asks a package
 * not to have. It is retained (and delegates to the SAME builder, so the two
 * cannot drift) so that swapping a host over is a separate, revertible change
 * from publishing the factory.
 *
 * The gate and the resolver are read through getters at CALL time, because the
 * setters run after this module is evaluated — the auth route calls them at
 * import time. Capturing their values at build time would freeze both at `null`
 * and fail every sign-in closed.
 */

let signInGate: SignInGate | null = null;
let sessionAdminResolver: SessionAdminResolver | null = null;

/**
 * Install the sign-in gate (call once at startup).
 *
 * @deprecated Pass `signInGate` to `createApiAuth` instead.
 */
export function setSignInGate(gate: SignInGate | null): void {
  signInGate = gate;
}

/**
 * Install the session admin resolver (call once at startup).
 *
 * @deprecated Pass `sessionAdmin` to `createApiAuth` instead.
 */
export function setSessionAdminResolver(
  resolver: SessionAdminResolver | null,
): void {
  sessionAdminResolver = resolver;
}

/**
 * Auth.js configuration, split out from the request handler so it can be
 * imported without pulling the full server runtime — useful for tests.
 *
 * @deprecated Use the `config` returned by `createApiAuth` instead.
 */
export const authConfig: AuthConfig = buildAuthConfig({
  getSignInGate: () => signInGate,
  getSessionAdmin: () => sessionAdminResolver,
  getAdminEmails: () => getEnv().ADMIN_EMAILS,
});

export type { ExtendedSession, SignInGate, SessionAdminResolver } from "./build-config";
