import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiReportBuilder,
  type ReportActor,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from '../server/create-report-builder';
import { messagesOf } from '../server/context';

/**
 * `@12-apps/report-builder/hono` — the reports endpoints as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use. It lives behind its own subpath
 * with `hono` as an OPTIONAL peer, so a host on Express — or one that only
 * wants the React surface — never resolves Hono at all. Importing the package
 * root or `/server` does not reach this file.
 *
 * A host writes:
 *
 *   app.route('/api/admin/:tenantSlug', reportBuilderRouter({ …, resolveActor }))
 *
 * and keeps what is genuinely its own: who the caller is, and whether they may
 * author. Everything after that — parsing, visibility, status codes, the
 * envelope — is the package's.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers
 * 401 before any handler runs.
 *
 * This is the one thing the package cannot supply: authentication, tenant
 * resolution and RBAC are the host's, and a package that guessed at them would
 * be wrong for every host but the first.
 */
export type ResolveActor = (c: Context) => Promise<ReportActor | null> | ReportActor | null;

export interface ReportBuilderHonoConfig extends ReportBuilderServerConfig {
  resolveActor: ResolveActor;
  /**
   * Which language to answer this caller in, as a BCP-47 tag.
   *
   * An ADAPTER seam, deliberately, because the adapter is the only layer that
   * holds the cookie, the header and whatever preference the host stored — and
   * this package negotiates none of it. Omit it and every request answers with
   * the default rendering of `messages`, which is the whole behaviour of a host
   * with one audience.
   *
   * Pointless unless `messages` is a resolver: a plain pack has one rendering.
   */
  resolveLocale?: (c: Context) => string | undefined;
}

/**
 * Hono and this package spell path params the same way (`:id`), so a
 * descriptor's path mounts verbatim. Asserting that here rather than assuming
 * it: a future descriptor using another syntax would otherwise mount a literal
 * path and 404 at runtime.
 */
function honoPath(route: ReportRoute): string {
  return route.path;
}

/** What `readBody` answers for a body that is present but is not JSON. */
const MALFORMED = Symbol('malformed');

/**
 * Reads the JSON body. Absent is `undefined` (the handler's strict parse refuses
 * it with a 422); present but not JSON is {@link MALFORMED}, which the adapter
 * answers 400 itself: malformed JSON is a transport error, never a validation one.
 */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') return undefined;
  const text = await c.req.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return MALFORMED;
  }
}

export function reportBuilderRouter(config: ReportBuilderHonoConfig): Hono {
  const { routes } = createApiReportBuilder(config);
  const app = new Hono();

  for (const route of routes) {
    const handler = async (c: Context) => {
      const locale = config.resolveLocale?.(c);
      const actor = await config.resolveActor(c);
      // Rendered per request like every other sentence here, so a 401 cannot be
      // the one answer stuck in the language the process booted with.
      if (!actor) {
        return c.json({ error: messagesOf(config, locale).unauthenticated }, 401);
      }

      const body = await readBody(c);
      if (body === MALFORMED) return c.json({ error: messagesOf(config, locale).invalidBody }, 400);

      const response = await route.handle({
        actor,
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        body,
        ...(locale === undefined ? {} : { locale }),
      });

      // A handler that chose NO body means exactly that (204). Serializing
      // `undefined` would put the four bytes `null` in a response whose status
      // promises no content at all.
      if (response.body === undefined) return c.body(null, response.status as 204);

      // The status travels with the body the handler chose; this adapter never
      // reinterprets either, or the two halves of the contract would drift
      // again — which is the whole reason the handlers moved here.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    };

    const path = honoPath(route);
    if (route.method === 'GET') app.get(path, handler);
    else if (route.method === 'POST') app.post(path, handler);
    else if (route.method === 'PUT') app.put(path, handler);
    else app.delete(path, handler);
  }

  return app;
}
