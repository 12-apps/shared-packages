/**
 * `@12-apps/notifications/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiNotifications` in a WIRE VIEW, and the reason
 * is one field. `NotificationsRequest` carries `headers` — the contract's
 * `WireRequest` does not, because headers are the adapter's business
 * everywhere else — and exactly one descriptor reads it: push-subscribe takes
 * `user-agent` as the DEVICE HINT it labels a subscription with. Without the
 * view the field would simply be absent at runtime while still type-checking,
 * and every saved device would come back unnamed: a silent quality loss, the
 * failure mode the wiring contract exists to convert into a loud one.
 *
 * So the view derives `headers` from the raw request the contract already
 * carries for the handlers `params`/`query`/`body` cannot serve. A host whose
 * adapter leaves `request` unset still gets a working surface — every route
 * answers, the subscription saves — with an unnamed device, which is the
 * honest degradation for a hint. `@12-apps/notifications/hono` populates it.
 *
 * Everything else rides beside the mapped routes on the aggregate unchanged:
 * `notify`, `notifyByPermission`, `dispatchDeliveries`, `drainPending`, the
 * three stores, `registerGenerator` and the transports registry. A host still
 * calls those directly — being mounted does not make the emit front door stop
 * being a library.
 */

import type { AnyServerManifest, WireRequest } from '@12-apps/wiring';

import {
  createApiNotifications,
  NOTIFICATIONS_JOBS,
  type ApiNotifications,
  type NotificationsRoute,
  type NotificationsServerConfig,
} from '../server';

/** The header names this surface reads — the device hint, and nothing else. */
const READ_HEADERS = ['user-agent'] as const;

/** The headers the package expects, taken off the raw request when there is one. */
function headersOf(request: WireRequest<never>): Record<string, string | undefined> {
  const raw = request.request;
  if (!raw) return {};
  return Object.fromEntries(
    READ_HEADERS.map((name) => [name, raw.headers.get(name) ?? undefined]),
  );
}

/** One `NotificationsRoute` as the wiring contract reads it. */
function asWireRoute(route: NotificationsRoute): {
  method: NotificationsRoute['method'];
  path: string;
  handle(request: WireRequest<never>): Promise<{ status: number; body: unknown }>;
} {
  return {
    method: route.method,
    path: route.path,
    handle: (request) =>
      route.handle({
        actor: request.actor,
        params: request.params,
        query: request.query,
        body: request.body,
        headers: headersOf(request),
      }),
  };
}

/** `createApiNotifications`, its routes re-shaped for the aggregate. */
export function createWireApiNotifications(
  config: NotificationsServerConfig,
): Omit<ApiNotifications, 'routes'> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiNotifications(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const notificationsServerManifest = {
  name: '@12-apps/notifications',
  http: { create: createWireApiNotifications },
  /**
   * The dispatch fast path and the retry sweep, with their cadence. The host
   * binds `{ dispatchDeliveries, drainPending }` off its own mount — the two
   * methods the aggregate already hands it — and deletes the hand-rolled
   * copies. See `../server/jobs` for why the numbers are the package's.
   */
  jobs: NOTIFICATIONS_JOBS,
} as const satisfies AnyServerManifest;
