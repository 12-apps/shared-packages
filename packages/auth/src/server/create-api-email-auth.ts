import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import {
  emailAuthRoutes,
  type EmailAuthRoute,
  type EmailAuthRoutesConfig,
} from "./email-routes";
import {
  emailAuthSettingsRoutes,
  type EmailAuthSettingsRoutesConfig,
} from "./settings-routes";

/**
 * The two surfaces as `@12-apps/wiring` HTTP contributions.
 *
 * `emailAuthRoutes` already answers the right shape in spirit — a method, a
 * path and a `handle` — but its request is `{ body, userId }`, from before the
 * wiring contract existed. `WireRequest` is `{ actor, params, query, body }`,
 * and the difference is not cosmetic: `actor` is resolved by the HOST and
 * handed in, where `userId` was resolved by a callback the package held.
 *
 * That inversion is the point. Who is calling, and with which status a refusal
 * answers, are the two things a package genuinely cannot know — and the old
 * seam could only express one of them. `resolveUserId` returned `string |
 * null`, so `null` became 401 for every refusal, and a host whose gate has a
 * second refusal (signed in, but not permitted: a **403**) had nowhere to put
 * it. Under the wire contract the host answers both before the route runs, and
 * `actor` arrives already proven.
 *
 * Adapted rather than replaced: `emailAuthRoutes` and the Hono adapter stay
 * exactly as they are, so a host not on the wiring contract is untouched.
 */

/**
 * The signed-in caller, as this package needs it: an opaque user id, or `null`
 * for nobody.
 *
 * Local rather than exported — a host reads it off `WireRoute`'s own parameter
 * and never needs to name it, and an exported alias nothing imports is exactly
 * what the unused-exports gate exists to catch.
 */
type AuthActor = string | null;

/** Turn one descriptor into a wire route, keeping the session refusal. */
function toWireRoute(route: EmailAuthRoute): WireRoute<AuthActor> {
  return {
    method: route.method,
    path: route.path,
    handle: async (request: WireRequest<AuthActor>): Promise<WireResponse> => {
      // Still refused HERE rather than left to the host, because `session` is a
      // property of the ROUTE — which endpoints need a caller is this package's
      // answer, and a host that had to restate it per route would eventually
      // restate one of them wrong. The host supplies WHO; the route decides
      // whether it needed anybody.
      if (route.session && !request.actor) {
        return { status: 401, body: { error: "unauthenticated" } };
      }
      return route.handle({ body: request.body, userId: request.actor });
    },
  };
}

/**
 * The shopper-facing surface: sign up, verify, sign in, forget, reset, and the
 * account's own password card.
 */
export function createApiEmailAuth(config: EmailAuthRoutesConfig): {
  routes: WireRoute<AuthActor>[];
} {
  return { routes: emailAuthRoutes(config).map(toWireRoute) };
}

/**
 * The operator-facing surface: the two platform switches.
 *
 * A SEPARATE contribution, and therefore a separate manifest, because these
 * endpoints turn a sign-in method off for everybody. They mount at a different
 * path, behind a different gate, for a different audience — and in the origin
 * host they also sit off the MCP surface by exclusion, which matters more here
 * than most: a tool that could turn verification off would open unverified
 * registration on the whole platform in one call.
 */
export function createApiEmailAuthSettings(config: EmailAuthSettingsRoutesConfig): {
  routes: WireRoute<AuthActor>[];
} {
  return { routes: emailAuthSettingsRoutes(config).map(toWireRoute) };
}
