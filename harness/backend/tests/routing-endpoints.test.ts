/**
 * `@12-apps/routing` as a CONSUMER gets it: the published route descriptor,
 * mounted by a host with its own provider list, its own `authorize` and its
 * own fetch (`src/routing-host.ts`).
 *
 * The planner's rules have a unit suite upstream. What these assert is the
 * half a package cannot test alone: that the tarball's server entry, adopted
 * through the wiring consumer and mounted on Hono, answers a host's caller —
 * the provider order the host chose, the fallback when its road provider is
 * gone, and the refusals in front of both.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { ROUTING_PERSON_COOKIE, routingOutage } from '../src/routing-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

const URL_ = '/api/admin/harness/routing/route';

const TRIP = {
  origin: { lng: -46.6333, lat: -23.5505 },
  stops: [
    { lng: -46.64, lat: -23.56 },
    { lng: -46.65, lat: -23.57 },
  ],
  returnTo: { lng: -46.6333, lat: -23.5505 },
};

interface Planned {
  provider: string | null;
  fallback: boolean;
  geometry: [number, number][];
  legs: { distanceM: number; durationS: number | null }[];
  failures: { provider: string; kind: string; detail?: string }[];
}

function plan(body: unknown, person: string | null = 'dispatcher'): Promise<Response> {
  return Promise.resolve(
    backend.app.request(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(person ? { cookie: `${ROUTING_PERSON_COOKIE}=${person}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

it('routes on the road through the second provider when the first is unconfigured', async () => {
  const response = await plan(TRIP);
  expect(response.status).toBe(200);
  const route = (await response.json()) as Planned;
  expect(route.provider).toBe('osrm');
  expect(route.fallback).toBe(false);
  expect(route.legs).toHaveLength(3);
  expect(route.legs.every((leg) => leg.durationS === 240)).toBe(true);
  expect(route.failures).toEqual([{ provider: 'openrouteservice', kind: 'unconfigured' }]);
});

it('falls back to straight segments with no durations when the road provider is down', async () => {
  routingOutage.osrmDown = true;
  const response = await plan(TRIP);
  expect(response.status).toBe(200);
  const route = (await response.json()) as Planned;
  expect(route.fallback).toBe(true);
  expect(route.provider).toBeNull();
  expect(route.geometry).toHaveLength(4);
  expect(route.legs.map((leg) => leg.durationS)).toEqual([null, null, null]);
  expect(route.failures.map((failure) => [failure.provider, failure.kind])).toEqual([
    ['openrouteservice', 'unconfigured'],
    ['osrm', 'http'],
  ]);
  expect(route.failures.some((failure) => 'detail' in failure)).toBe(false);
});

it('refuses a caller the host does not authorize, and one it cannot resolve', async () => {
  expect((await plan(TRIP, 'stranger')).status).toBe(403);
  expect((await plan(TRIP, null)).status).toBe(401);
});

it('refuses a body it cannot route before any provider is asked', async () => {
  const response = await plan({ origin: { lng: 0, lat: 0 }, stops: [] });
  expect(response.status).toBe(400);
});
