/**
 * openrouteservice (OpenStreetMap data, the same map the default basemap
 * draws). `POST /v2/directions/{profile}/geojson` with every waypoint in one
 * call; the answer's single feature carries the line and one segment per leg.
 */

import { toPosition } from "../core/geo";
import { waypointsOf, type ProviderOutcome, type RoutingProvider } from "../core/provider";
import type { RouteLeg } from "../core/types";

import { fetchJson, legsOf, numberOr, positionsOf, routeOutcome } from "./http";

export interface OpenRouteServiceOptions {
  /** The account's API key. Empty/absent = every attempt is `unconfigured`. */
  apiKey: string | undefined;
  /** ORS profile. `driving-car` is the closest public profile to a motorbike. */
  profile?: string;
  /** Override for a self-hosted instance. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.openrouteservice.org";

interface OrsSegment {
  distance?: unknown;
  duration?: unknown;
}

interface OrsBody {
  features?: { geometry?: { coordinates?: unknown }; properties?: { segments?: OrsSegment[] } }[];
}

export function openRouteServiceProvider(options: OpenRouteServiceOptions): RoutingProvider {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const profile = options.profile ?? "driving-car";
  return {
    name: "openrouteservice",
    async route(request, { fetch, signal }): Promise<ProviderOutcome> {
      if (!options.apiKey) return { ok: false, kind: "unconfigured" };
      const answer = await fetchJson({
        fetch,
        signal,
        url: `${base}/v2/directions/${encodeURIComponent(profile)}/geojson`,
        isNoRoute: orsNoRoute,
        init: {
          method: "POST",
          headers: { authorization: options.apiKey, "content-type": "application/json", accept: "application/geo+json" },
          body: JSON.stringify({ coordinates: waypointsOf(request).map(toPosition) }),
        },
      });
      if (!answer.ok) return answer;
      const feature = (answer.body as OrsBody).features?.[0];
      return routeOutcome(positionsOf(feature?.geometry?.coordinates), legsOf(feature?.properties?.segments, legOf));
    },
  };
}

/**
 * ORS answers "no route" (2009) and "no routable point near a waypoint" (2010)
 * with 404 — the same status as a wrong profile or URL, so the body decides.
 */
function orsNoRoute(status: number, body: unknown): boolean {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return status === 404 && (code === 2009 || code === 2010);
}

function legOf(segment: OrsSegment): RouteLeg | null {
  const distanceM = numberOr(segment.distance, 0);
  const durationS = numberOr(segment.duration, 0);
  return distanceM === null || durationS === null ? null : { distanceM, durationS };
}
