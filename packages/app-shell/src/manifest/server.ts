/**
 * `@12-apps/app-shell/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiAppShell` in a WIRE VIEW, for two fields the
 * contract's `WireRequest`/`WireResponse` pair does not carry.
 *
 * **`header` and `raw`, inbound.** `AppShellRequest` gives a handler a
 * `header(name)` accessor and an adapter-shaped `raw` escape hatch, and
 * NEITHER is read by any descriptor in this package — both exist for the one
 * seam the host fills, `consent.resolveActor`, which reads that host's own
 * session cookie. So the view has to keep them reaching the host: `header`
 * is derived from the raw fetch `Request` the contract already carries, and
 * `raw` is that same request. A host whose adapter leaves `request` unset
 * still gets a working surface — `header` answers `undefined` and `raw` is
 * absent — which is honest for a host that resolves its actor some other
 * way, and immediately visible to one that does not.
 *
 * **`cookies`, outbound.** `AppShellResponse` carries cookie INSTRUCTIONS
 * because a framework-neutral handler has no response object to set one on,
 * and the acceptance plants a signed handoff cookie whose whole job is to
 * carry consent from a sign-up form through the OAuth round trip. Every
 * attribute of it — `httpOnly`, `sameSite`, `path`, `maxAge`, `secure` — is
 * already this package's decision, so serializing it is mechanism, not host
 * policy. An answer carrying cookies therefore becomes the contract's RAW
 * half (`{ response }`, wiring 1.9.0) with `Set-Cookie` set; an answer
 * without one stays `{ status, body }` so the consumer's own primitives
 * shape it. That is the impersonation manifest's split, for the same reason:
 * leaving the cookie to each host is what made "the acceptance succeeded but
 * the cookie never left" a per-adapter bug — a sign-up flow that loses
 * consent at the OAuth hop and reports success.
 *
 * The 204 keeps NO body, deliberately: `noContent` returns `body: undefined`
 * rather than `null`, which a client would parse as a value.
 *
 * Both routes are `public`. Consent precedes having an account — the status
 * read answers `stale: false` for an anonymous caller and the acceptance
 * plants the handoff cookie for exactly the caller who has no account yet —
 * so a host RBAC gate in front of either would refuse the callers they are
 * for. `public` is also the contract's kind that forbids a `permission`,
 * which is the property that has to hold.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from '@12-apps/wiring';

import {
  createApiAppShell,
  type ApiAppShell,
  type AppShellCookie,
  type AppShellResponse,
  type AppShellRoute,
  type AppShellServerConfig,
} from '../server';

/** `Set-Cookie` for one cookie instruction, attributes and all. */
export function serializeCookie(cookie: AppShellCookie): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    `SameSite=${cookie.sameSite === 'lax' ? 'Lax' : cookie.sameSite === 'strict' ? 'Strict' : 'None'}`,
  ];
  if (cookie.httpOnly) parts.push('HttpOnly');
  if (cookie.secure) parts.push('Secure');
  return parts.join('; ');
}

/** The descriptor's chosen answer, as the wiring contract carries it. */
export function asWireAnswer(answer: AppShellResponse): WireRouteAnswer {
  const cookies = answer.cookies ?? [];
  if (cookies.length === 0) return { status: answer.status, body: answer.body };
  const headers = new Headers();
  if (answer.body !== undefined) headers.set('content-type', 'application/json');
  for (const cookie of cookies) headers.append('set-cookie', serializeCookie(cookie));
  return {
    response: new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers,
    }),
  };
}

/** One `AppShellRoute` as the wiring contract reads it. */
function asWireRoute(route: AppShellRoute): {
  method: AppShellRoute['method'];
  path: string;
  kind: 'public';
  handle(request: WireRequest): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    kind: 'public',
    handle: async (request) =>
      asWireAnswer(
        await route.handle({
          params: request.params,
          query: request.query,
          header: (name) => request.request?.headers.get(name) ?? undefined,
          raw: request.request,
        }),
      ),
  };
}

/** `createApiAppShell`, its routes re-shaped for the aggregate. */
export function createWireApiAppShell(
  config: AppShellServerConfig,
): Omit<ApiAppShell, 'routes'> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiAppShell(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const appShellServerManifest = {
  name: '@12-apps/app-shell',
  http: { create: createWireApiAppShell },
} as const satisfies AnyServerManifest;
