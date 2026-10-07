/**
 * The `@12-apps/routing` adoption, through the wiring consumer like the chat
 * and pwa surfaces beside it.
 *
 * What is genuinely the HOST's, and all that is here: which routing services
 * are tried and in what order (the provider list), who may ask for a route
 * (`authorize`), and the fetch the adapters go out through. Everything else —
 * the body validation, the stop cap, the per-provider timeout, the
 * straight-line fallback and the rule that a provider's raw error text never
 * reaches the caller — is the package's, which is the claim under test.
 *
 * ## Two providers, and neither reaches the network
 *
 * A harness that called a real routing service would be red whenever that
 * service was, so both entries are answered by the host's own `fetch`:
 *
 * - openrouteservice with NO key, which is the state a host is in before
 *   anyone configured it: the package must record it as `unconfigured` and
 *   move on rather than send a keyless request;
 * - OSRM at a base URL this host's fetch answers itself, with a canned road
 *   route — the swap from one provider to the next is a config change here
 *   and nowhere else, which is what the package promises.
 *
 * `ROUTING_OSRM_DOWN` lets a case take OSRM away, and then the answer must be
 * the straight-line fallback with no durations.
 */
import { routingManifest } from '@12-apps/routing/manifest';
import { routingServerManifest } from '@12-apps/routing/manifest/server';
import { openRouteServiceProvider, osrmProvider } from '@12-apps/routing/server';
import { createWiringHost } from '@12-apps/wiring/consumer';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** Where `mount-surfaces.ts` hangs the one route: `POST …/routing/route`. */
export const ROUTING_MOUNT_PATH = '/api/admin/:tenantSlug/routing';

/** The cookie this host resolves the caller from — its stand-in for a session. */
export const ROUTING_PERSON_COOKIE = 'harness_routing_person';

/** The OSRM this host pretends to run. Never resolved: the host's fetch answers it. */
export const ROUTING_OSRM_URL = 'http://osrm.harness.invalid';

/** The only callers allowed to plan a route. */
const DISPATCHERS = new Set(['dispatcher']);

/** A switch the suite flips to take the road provider away. */
export const routingOutage = { osrmDown: false };

/**
 * The host's fetch: answers the fake OSRM with one straight-ish leg per hop,
 * shaped the way OSRM's `route/v1` answers, and refuses everything else.
 */
const hostFetch: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== ROUTING_OSRM_URL) return new Response('not here', { status: 599 });
  if (routingOutage.osrmDown) return new Response('down', { status: 503 });
  const coordinates = url.pathname.split('/').pop()!.split(';').map((pair) => pair.split(',').map(Number));
  const legs = coordinates.slice(1).map(() => ({ distance: 1200, duration: 240 }));
  return Response.json({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates }, legs }] });
};

function routingActorOf(c: Context): { person: string } | null {
  const person = getCookie(c, ROUTING_PERSON_COOKIE);
  return person ? { person } : null;
}

export function routingHost() {
  const wiring = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });
  wiring.adoptServer({
    manifest: routingManifest,
    server: routingServerManifest,
    bindings: {
      http: {
        mountPath: ROUTING_MOUNT_PATH,
        config: {
          providers: [openRouteServiceProvider({ apiKey: undefined }), osrmProvider({ baseUrl: ROUTING_OSRM_URL })],
          fetch: hostFetch,
          timeoutMs: 2_000,
          authorize: (actor: { person: string } | null) => actor !== null && DISPATCHERS.has(actor.person),
        },
      },
    },
  });
  const wired = wiring.assemble();
  return {
    router: honoRouterFor(wired.routes, routingActorOf),
    report: wired.report,
    routes: wired.routes,
  };
}
