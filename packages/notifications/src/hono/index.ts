import { Hono } from 'hono';
import type { Context } from 'hono';

import { messagesOf } from '../messages';

import {
  createApiNotifications,
  type ApiNotifications,
  type NotificationsServerConfig,
} from '../server/create-api-notifications';
import type { NotificationsActor } from '../server/context';

/**
 * `@12-apps/notifications/hono` — the account notification endpoints as a
 * mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with
 * `hono` as an OPTIONAL peer (the report-builder precedent — a host on Express,
 * or one that only wants the React surface, never resolves Hono).
 *
 * A host writes:
 *
 *   const notifications = notificationsRouter({ …config, resolveActor });
 *   app.route('/api/account', notifications.router);
 *
 * and keeps what is genuinely its own: who the caller is. Everything after
 * that — parsing, status codes, the envelope, the pt-BR copy — is the
 * package's.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers 401
 * before any handler runs.
 *
 * Note the 401 is self-guarded HERE rather than assumed from middleware: these
 * paths sit under an API prefix that a host's page middleware typically does not
 * match, and an unauthenticated inbox read that fell through would answer
 * somebody else's rows or none at all — both worse than a 401.
 */
export type ResolveNotificationsActor = (
  c: Context,
) => Promise<NotificationsActor | null> | NotificationsActor | null;

export interface NotificationsHonoConfig extends NotificationsServerConfig {
  resolveActor: ResolveNotificationsActor;
}

export interface NotificationsHono extends ApiNotifications {
  router: Hono;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET') return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error; the handler's own validation
    // reports it far better than a parse failure would.
    return undefined;
  }
}

export function notificationsRouter(config: NotificationsHonoConfig): NotificationsHono {
  const api = createApiNotifications(config);
  const messages = messagesOf(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER, which any adapter must preserve. Hono resolves
  // by registration order, so a host route shaped `/notifications/:id` under the
  // same prefix must be registered AFTER this router or it captures
  // `/notifications/unread-count`.
  for (const route of api.routes) {
    const handler = async (c: Context): Promise<Response> => {
      const actor = await config.resolveActor(c);
      if (!actor) return c.json({ error: messages.unauthenticated }, 401);

      const response = await route.handle({
        actor,
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        body: await readBody(c),
        headers: { 'user-agent': c.req.header('user-agent') },
      });

      // A handler that chose NO body means exactly that (204).
      if (response.body === undefined) return c.body(null, response.status as 204);
      // The status travels with the body the handler chose; the adapter never
      // reinterprets either.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    };

    if (route.method === 'GET') router.get(route.path, handler);
    else if (route.method === 'POST') router.post(route.path, handler);
    else if (route.method === 'PUT') router.put(route.path, handler);
    else router.delete(route.path, handler);
  }

  return { ...api, router };
}
