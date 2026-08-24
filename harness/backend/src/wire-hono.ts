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
 *  - GET/HEAD carry no body; every other method may, DELETE included — an
 *    endpoint URL is not a path segment, so a delete-by-endpoint has nowhere
 *    else to put it. A malformed JSON body is `undefined` (the handler's own
 *    validation reports it better than a parse failure would);
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

import type { MountedRoute, WireRouteAnswer } from '@12-apps/wiring';

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

/**
 * The parsed JSON body — read from a CLONE, so the raw request below is still
 * readable.
 *
 * `c.req.json()` consumes the underlying stream, and a handler that then
 * reaches for `request.request` gets `ReadableStream is locked`. That is not
 * hypothetical: `@12-apps/storage` streams a multipart upload straight to its
 * driver, so it needs the raw request on the very routes whose body this would
 * otherwise have eaten. Cloning is what lets one bridge serve both kinds of
 * handler without asking a route to declare which it is.
 */
async function readBody(c: Context): Promise<unknown> {
  // GET and HEAD only. This used to skip DELETE too — inherited from the
  // per-package adapter this bridge was modelled on, where it happened to be
  // true — and it is not a rule of HTTP: `@12-apps/notifications` deletes a
  // push subscription BY ITS ENDPOINT, which travels in the body because an
  // endpoint URL is not a path segment. Skipping it handed that handler
  // `undefined` and the row survived, which a suite reading the response
  // envelope catches and a suite reading only the status does not.
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return undefined;
  try {
    return await c.req.raw.clone().json();
  } catch {
    // A malformed body — or a multipart one, which was never JSON. Either way
    // the handler's own validation reports it better than a parse failure
    // would.
    return undefined;
  }
}

/**
 * The two arms of `WireRouteAnswer`, discriminated on `response`.
 *
 * The raw one is "an answer the adapter must return UNTOUCHED: a live SSE
 * stream, a redirect whose headers are the payload, a provider-shaped webhook
 * body", and the contract spells out what happens without it — "a serialized
 * stream is a hung request and a redirect with no `Location` is a dead end".
 *
 * This bridge handled only the JSON arm, which was fine while every adopted
 * surface answered JSON and is the third thing `@12-apps/realtime` would have
 * broken on: its subscribe route holds a stream OPEN, and `c.json` over that is
 * a request that never completes.
 */
function respond(c: Context, answer: WireRouteAnswer): Response {
  if ('response' in answer) return answer.response;
  if (answer.body === undefined) return c.body(null, answer.status as 204);
  return c.json(answer.body as Record<string, unknown>, answer.status as 200);
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
        // The raw `Request`, forwarded for the handlers the parsed fields
        // cannot serve — a webhook verifying a signature over the exact bytes,
        // an SSE stream reading `Last-Event-ID`, a multipart upload streaming
        // to a driver. The contract says the host's adapter populates it for
        // `webhook` and `stream` routes "and may for the rest", and this one
        // does: forwarding it costs nothing (it is the object Hono already
        // holds), while NOT forwarding it is a runtime throw a package can
        // only report at the first request that needed it —
        // `@12-apps/storage` says exactly that, by name.
        //
        // A JSON handler must still not come to depend on it: `params`,
        // `query` and `body` are the halves every adapter is obliged to fill,
        // and they stay the ones the packages here read.
        request: c.req.raw,
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
