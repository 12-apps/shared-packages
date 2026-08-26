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

/**
 * The adapter takes the server config, plus the one thing only an adapter can
 * answer: which language this caller is reading in.
 *
 * `resolveLocale` is OPTIONAL and has no default, and both halves of that are
 * deliberate. Precedence between `?lang=`, a remembered cookie, a stored user
 * or tenant preference and `Accept-Language` is host POLICY — the estate's own
 * host deliberately ignores the header, because a page whose browser half
 * cannot honour it would come back half-translated — so a package that picked
 * an order would be picking it for every adopter. And a host with one audience
 * needs none of it: omit the seam, `AppShellRequest.locale` stays absent, and
 * {@link AppShellServerConfig.messages} answers with the pack it was
 * configured with.
 *
 * A host that already resolves a locale writes one line:
 *
 * ```ts
 * appShellRouter({ …config, resolveLocale: (c) => resolveRequestLocale(c.req.raw) })
 * ```
 *
 * The mount through `@12-apps/wiring` needs nothing: `WireRequest` carries the
 * tag already and `manifest/server` copies it across.
 */
export interface AppShellHonoConfig extends AppShellServerConfig {
  /** The reader's language tag, or `undefined` for "nobody said". */
  resolveLocale?(c: Context): string | undefined;
}

export interface AppShellHono extends ApiAppShell {
  router: Hono;
}

/** The normalized request a descriptor sees, built from a Hono context. */
function toAppShellRequest(c: Context, config: AppShellHonoConfig): AppShellRequest {
  const locale = config.resolveLocale?.(c);
  return {
    params: c.req.param() as Record<string, string | undefined>,
    query: c.req.query() as Record<string, string | undefined>,
    header: (name: string) => c.req.header(name),
    // The escape hatch `resolveActor` needs: reading a session cookie is host
    // work, and no handler in the package touches it.
    raw: c,
    // Spread rather than assigned, so an unwired seam leaves the key ABSENT
    // instead of present-and-undefined. The two are the same to a resolver and
    // not to a reader of this object, and absent is the honest one.
    ...(locale === undefined ? {} : { locale }),
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

function mount(router: Hono, route: AppShellRoute, config: AppShellHonoConfig): void {
  const handler = async (c: Context): Promise<Response> =>
    respond(c, await route.handle(toAppShellRequest(c, config)));
  if (route.method === 'GET') router.get(route.path, handler);
  else router.post(route.path, handler);
}

/** Build the surface and its Hono router in one call. */
export function appShellRouter(config: AppShellHonoConfig): AppShellHono {
  const shell = createApiAppShell(config);
  const router = new Hono();
  // Verbatim, in the order the surface declares — see `routes.ts`.
  for (const route of shell.routes) mount(router, route, config);
  return { ...shell, router };
}
