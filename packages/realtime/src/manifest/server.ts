/**
 * `@12-apps/realtime/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiEvents` in a WIRE VIEW: the factory's own
 * `EventsRoute` descriptors carry `kind: "stream" | "json"` and answer
 * either `{ status, body }` or a raw `{ response }` — exactly the shapes the
 * wiring contract's `transport` field and answer union carry — so the view
 * renames `kind` to `transport` and forwards the raw request, changing
 * nothing else. The full factory result (`start`, `stop`, `connections`,
 * `outbox`) rides beside the mapped routes on the aggregate, because a host
 * must still call `start()` once per process and drive shutdown.
 *
 * `jobs` is `REALTIME_JOBS` (`../jobs`): the outbox drain — the contract's
 * sub-minute `interval` case — and the daily purge. A host that keeps the
 * outbox off (`config.outbox` absent) DECLINES the jobs binding in writing;
 * the origin host does exactly that today, which is what a written decline
 * is for.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from "@12-apps/wiring";

import { createApiEvents, type EventsApi, type EventsRoute, type EventsServerConfig } from "../server";
import { REALTIME_JOBS } from "../jobs";

/** One `EventsRoute` as the wiring contract reads it. */
function asWireRoute(route: EventsRoute): {
  method: EventsRoute["method"];
  path: string;
  transport: "json" | "stream";
  handle(request: WireRequest<never>): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    transport: route.kind,
    handle: (request) =>
      route.handle({
        params: request.params,
        query: request.query,
        ...(request.request !== undefined ? { request: request.request } : {}),
      }),
  };
}

/** `createApiEvents`, its routes re-shaped for the aggregate. */
export function createWireApiEvents(
  config: EventsServerConfig,
): Omit<EventsApi, "routes"> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiEvents(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const realtimeServerManifest = {
  name: "@12-apps/realtime",
  http: { create: createWireApiEvents },
  jobs: REALTIME_JOBS,
} as const satisfies AnyServerManifest;
