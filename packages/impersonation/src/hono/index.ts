import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiImpersonation,
  type ApiImpersonation,
} from '../server/create-api-impersonation';
import {
  foldApiError,
  type ImpersonationActor,
  type ImpersonationRoute,
  type ImpersonationServerConfig,
} from '../server/context';

/**
 * `@12-apps/impersonation/hono` — the two mounts as routers.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono`
 * as an OPTIONAL peer — a host on Express, or one that only wants the React
 * surface, never resolves it.
 *
 * A host writes:
 *
 *   const impersonation = impersonationRouter({ …config, resolveActor });
 *   app.route('/api/platform/impersonation', impersonation.platform);
 *   app.route('/api/admin/:tenantSlug/impersonation', impersonation.tenant);
 *
 * and keeps what is genuinely its own: who the caller is. TWO routers rather
 * than one because the two mounts are at genuinely different bases — one is
 * tenant-scoped and one deliberately is not, for the reason spelled out on the
 * platform surface.
 */

/**
 * Resolve the caller.
 *
 * NEVER returns null: the GET on the platform surface is answerable by an
 * anonymous visitor (a storefront mounts the banner for shoppers), and this
 * package's own gates decide the rest. A host that wants to 401 does it in its
 * own middleware, above this mount.
 */
export type ResolveImpersonationActor = (
  c: Context,
) => Promise<ImpersonationActor> | ImpersonationActor;

export interface ImpersonationHonoConfig extends ImpersonationServerConfig {
  resolveActor: ResolveImpersonationActor;
}

export interface ImpersonationHono extends ApiImpersonation {
  /** Mount at the shared session surface (start / stop / describe). */
  platform: Hono;
  /** Mount at the tenant-scoped preview surface, with a `:tenantSlug` param. */
  tenant: Hono;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error; the handler's own validation
    // reports it far better than a parse failure would.
    return undefined;
  }
}

function register(
  router: Hono,
  route: ImpersonationRoute,
  config: ImpersonationHonoConfig,
): void {
  const handler = async (c: Context) => {
    const response = await route
      .handle({
        actor: await config.resolveActor(c),
        params: c.req.param() as Record<string, string | undefined>,
        body: await readBody(c),
        cookieValue: readCookie(c, config.cookieName),
      })
      .catch(foldApiError);

    // The cookie travels WITH the response the handler chose, so "the session
    // started but the cookie never left" cannot be an adapter bug.
    if (response.cookie) {
      c.header('Set-Cookie', serializeCookie(response.cookie), { append: true });
    }
    return c.json(response.body as Record<string, unknown>, response.status as 200);
  };

  // `path || '/'` — a descriptor's `''` means the mount itself, which Hono
  // spells `/`.
  const path = route.path || '/';
  if (route.method === 'GET') router.get(path, handler);
  else if (route.method === 'POST') router.post(path, handler);
  else router.delete(path, handler);
}

/**
 * Read one cookie from the raw header.
 *
 * Hand-parsed rather than through Hono's `getCookie` so this adapter pulls in
 * nothing beyond the `hono` peer itself, and so the parse is visible: a value
 * containing `=` (this cookie's payload is base64-ish and routinely does) must
 * survive, which a naive `split('=')` loses.
 */
function readCookie(c: Context, name: string): string | undefined {
  const header = c.req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const entry = part.trim();
    const eq = entry.indexOf('=');
    if (eq > 0 && entry.slice(0, eq) === name) return entry.slice(eq + 1);
  }
  return undefined;
}

function serializeCookie(cookie: {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string; maxAge: number };
}): string {
  const { options } = cookie;
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=Lax`,
    'HttpOnly',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function impersonationRouter(config: ImpersonationHonoConfig): ImpersonationHono {
  const api = createApiImpersonation(config);
  const platform = new Hono();
  const tenant = new Hono();

  for (const route of api.routes) {
    register(route.surface === 'platform' ? platform : tenant, route, config);
  }

  return { ...api, platform, tenant };
}
