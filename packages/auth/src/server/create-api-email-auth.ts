import type { WireRequest, WireRoute, WireRouteAnswer } from "@12-apps/wiring";

import { isForgedPost, parseCookieHeader, serializeAuthCookie } from "./auth-cookies";

import {
  emailAuthRoutes,
  type EmailAuthResponse,
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

/**
 * A handler's answer as the wire contract carries it.
 *
 * `{ status, body }` has nowhere to put a header, so an answer that sets a
 * cookie (only sign-up's binding, today) goes out RAW, as the same JSON with
 * its `Set-Cookie` lines. Everything else stays on the JSON half.
 */
function toAnswer(result: EmailAuthResponse, canSetCookies: boolean): WireRouteAnswer {
  if (!canSetCookies || !result.cookies?.length) return { status: result.status, body: result.body };
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of result.cookies) headers.append("Set-Cookie", serializeAuthCookie(cookie));
  return { response: new Response(JSON.stringify(result.body), { status: result.status, headers }) };
}

/** Turn one descriptor into a wire route, keeping the session refusal. */
function toWireRoute(route: EmailAuthRoute): WireRoute<AuthActor, WireRouteAnswer> {
  return {
    method: route.method,
    path: route.path,
    /**
     * The route's own `session` flag, said in the contract's vocabulary.
     *
     * Six of the eight endpoints here are anonymous BY DEFINITION — sign up,
     * verify, sign in, forget a password, reset it — and `kind` defaults to
     * `authenticated`, which is what a host's gate reads. So a consumer that
     * honours the contract (as it must: `public` is "anonymous by design", a
     * `webhook` "must NOT sit behind tenant guards") would refuse the whole
     * sign-in surface with 401 before a handler ran, while the two account
     * routes worked — a package nobody could sign in to, mounting cleanly.
     *
     * The Hono adapter never noticed because it asks `route.session` itself.
     * Only the wire view has to SAY it, and this is the line that does.
     */
    kind: route.session === true ? "authenticated" : "public",
    handle: async (request: WireRequest<AuthActor>): Promise<WireRouteAnswer> => {
      // Still refused HERE rather than left to the host, because `session` is a
      // property of the ROUTE — which endpoints need a caller is this package's
      // answer, and a host that had to restate it per route would eventually
      // restate one of them wrong. The host supplies WHO; the route decides
      // whether it needed anybody.
      if (route.session && !request.actor) {
        return { status: 401, body: { error: "unauthenticated" } };
      }
      // Cookies come off the raw request, which a host's adapter may pass for
      // any route. Without it there is no proving the call came from this
      // site, so no binding is set and none is read: confirmation links then
      // verify and sign nobody in, which is the safe way to be miswired.
      const raw = request.request;
      if (raw && isForgedPost(raw)) return { status: 403, body: { error: "forbidden" } };
      const cookies = parseCookieHeader(raw?.headers.get("cookie"));
      return toAnswer(
        await route.handle({ body: request.body, userId: request.actor, cookies }),
        raw !== undefined,
      );
    },
  };
}

/**
 * The shopper-facing surface: sign up, verify, sign in, forget, reset, and the
 * account's own password card.
 */
export function createApiEmailAuth(config: EmailAuthRoutesConfig): {
  routes: WireRoute<AuthActor, WireRouteAnswer>[];
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
  routes: WireRoute<AuthActor, WireRouteAnswer>[];
} {
  return { routes: emailAuthSettingsRoutes(config).map(toWireRoute) };
}
