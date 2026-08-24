/**
 * The host's ONE bridge from wiring-contract routes to Hono.
 *
 * This is the piece a real adopter writes once, for every package it adopts —
 * where today each package ships its own framework adapter and each host
 * mounts them one by one. The translation rules are the ones
 * `@12-apps/report-builder/hono` established, held here verbatim so the
 * consumer path answers byte-for-byte what the per-package adapter answers:
 *
 *  - a `null` actor is 401 before any handler runs;
 *  - GET/DELETE carry no body; a malformed JSON body is `undefined` (the
 *    handler's own validation reports it better than a parse failure would);
 *  - a handler that chose NO body means exactly that (204) — serializing
 *    `undefined` would put four bytes of `null` in a response whose status
 *    promises no content;
 *  - the status travels with the body the handler chose; the bridge never
 *    reinterprets either.
 *
 * Routes arrive from `assemble()` ALREADY specificity-ordered, and Hono
 * resolves by registration order — so registering in the given order is what
 * turns the consumer's ordering guarantee into routing behaviour.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { MountedRoute, WireResponse } from '@12-apps/wiring';

/**
 * The route's path in HONO's syntax.
 *
 * `wildcardParam` names the trailing parameter that swallows the rest of the
 * path; the contract carries the NAME because `:key{.+}` is Hono's spelling and
 * `*key` is Express's, and a package writing either would have chosen its
 * host's framework. Composing it here is the adapter's half of that bargain.
 *
 * `:key{.+}` and not `*`: the whole remainder is ONE parameter, which is what
 * makes a nested key (`products/<scope>/<uuid>/card-320.webp`) arrive intact
 * instead of as a path Hono has already split.
 *
 * An adapter that ignores this does not fail loudly — it registers the prefix,
 * and every request carrying a deeper key 404s while the sibling routes keep
 * working. That is exactly how it hid.
 */
function honoPath(route: MountedRoute['route']): string {
  const wildcard = (route as { wildcardParam?: string }).wildcardParam;
  return wildcard === undefined ? route.path : `${route.path}/:${wildcard}{.+}`;
}

/** Resolve the caller; `null` answers 401 before any handler runs. */
export type ResolveWireActor = (c: Context) => Promise<unknown> | unknown;

async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function respond(c: Context, response: WireResponse): Response {
  if (response.body === undefined) return c.body(null, response.status as 204);
  return c.json(response.body as Record<string, unknown>, response.status as 200);
}

/**
 * A router serving the given mounted routes, addressed by their
 * package-relative paths — mount it at the prefix the adoption named as
 * `mountPath`, exactly as the per-package routers are mounted today.
 */
export function honoRouterFor(
  routes: readonly MountedRoute[],
  resolveActor: ResolveWireActor,
): Hono {
  const app = new Hono();
  routes.forEach((mounted) => {
    app.on(mounted.route.method, honoPath(mounted.route), async (c) => {
      const actor = await resolveActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const response = await mounted.route.handle({
        actor: actor as never,
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        body: await readBody(c),
      });
      return respond(c, response);
    });
  });
  return app;
}

/**
 * The harness's namespaced logger factory — its telemetry sink IS the
 * console, which is the one legitimate console call in the system (a real
 * host hands `createFeatureLogger` here instead).
 */
export function harnessLoggerFor(namespace: string): {
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: string, ...meta: unknown[]) => void;
} {
  return {
    info: (message, ...meta) => console.info(`[${namespace}] ${message}`, ...meta),
    warn: (message, ...meta) => console.warn(`[${namespace}] ${message}`, ...meta),
    error: (message, ...meta) => console.error(`[${namespace}] ${message}`, ...meta),
  };
}
