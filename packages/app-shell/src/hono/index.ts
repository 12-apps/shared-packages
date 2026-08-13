/**
 * `@12-apps/app-shell/hono` — the consent surface as a mountable router.
 *
 * The framework-neutral descriptors in `./server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono` as
 * an OPTIONAL peer (the report-builder precedent — a host on Express, or one that
 * only wants the browser shell, never resolves Hono; nothing under `.`, `./react`
 * or `./server` imports it).
 *
 * A host writes:
 *
 *   const shell = appShellRouter({ termsVersion, consent: { … } });
 *   app.route('/api', shell.router);
 *
 * and keeps what is genuinely its own: who the caller is, and where the acceptance
 * is stored.
 *
 * ## The envelope
 *
 * A success is `{ data }`; the acceptance answers `204` with no body at all. A
 * failure is `{ error }` at the top level with the status the handler chose, never
 * wrapped in `data` — an interceptor that unwraps `data` blindly would otherwise
 * turn an error body into a value.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';

import { createApiAppShell, type ApiAppShell } from '../server/create-api-app-shell';
import type {
  AppShellRequest,
  AppShellResponse,
  AppShellRoute,
  AppShellServerConfig,
} from '../server/config';

/** The adapter takes exactly the server config — there is no second thing to wire. */
export type AppShellHonoConfig = AppShellServerConfig;

export interface AppShellHono extends ApiAppShell {
  router: Hono;
}

/** The normalized request a descriptor sees, built from a Hono context. */
function toAppShellRequest(c: Context): AppShellRequest {
  return {
    params: c.req.param() as Record<string, string | undefined>,
    query: c.req.query() as Record<string, string | undefined>,
    header: (name: string) => c.req.header(name),
    // The escape hatch `resolveActor` needs: reading a session cookie is host
    // work, and no handler in the package touches it.
    raw: c,
  };
}

/**
 * Cookies BEFORE the body.
 *
 * `c.body(null, 204)` returns a finished Response, and a header written after that
 * lands nowhere — the acceptance would answer 204 with the handoff cookie silently
 * missing, which is a sign-up flow that loses consent at the OAuth hop.
 */
function respond(c: Context, response: AppShellResponse): Response {
  for (const cookie of response.cookies ?? []) {
    setCookie(c, cookie.name, cookie.value, {
      maxAge: cookie.maxAge,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite === 'lax' ? 'Lax' : cookie.sameSite === 'strict' ? 'Strict' : 'None',
      secure: cookie.secure,
    });
  }
  if (response.body === undefined) return c.body(null, response.status as 204);
  return c.json(response.body, response.status as 200);
}

function mount(router: Hono, route: AppShellRoute): void {
  const handler = async (c: Context): Promise<Response> =>
    respond(c, await route.handle(toAppShellRequest(c)));
  if (route.method === 'GET') router.get(route.path, handler);
  else router.post(route.path, handler);
}

/** Build the surface and its Hono router in one call. */
export function appShellRouter(config: AppShellHonoConfig): AppShellHono {
  const shell = createApiAppShell(config);
  const router = new Hono();
  // Verbatim, in the order the surface declares — see `routes.ts`.
  for (const route of shell.routes) mount(router, route);
  return { ...shell, router };
}
