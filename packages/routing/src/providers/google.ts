/**
 * Google Routes API (`directions/v2:computeRoutes`).
 *
 * **Licence note for hosts:** Google's Maps Platform terms do not allow
 * content from its services (this route line included) to be displayed on a
 * non-Google map. A host that draws with `RouteMap` over an OpenStreetMap
 * basemap must not list this provider; it exists for hosts that render on a
 * Google basemap, or that use only the durations.
 */

import { decodePolyline } from "../core/geo";
import type { ProviderOutcome, RoutingProvider } from "../core/provider";
import type { LngLat, RouteLeg, RouteRequest } from "../core/types";

import { fetchJson, legsOf, numberOr, routeOutcome, trimBase } from "./http";

export interface GoogleRoutesOptions {
  apiKey: string | undefined;
  /** `TWO_WHEELER` (default) or `DRIVE`. */
  travelMode?: "TWO_WHEELER" | "DRIVE";
  /** Ask for a traffic-aware duration (billed at the Pro tier). */
  trafficAware?: boolean;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://routes.googleapis.com";

interface GoogleLeg {
  distanceMeters?: unknown;
  duration?: unknown;
}

interface GoogleBody {
  routes?: { polyline?: { encodedPolyline?: unknown }; legs?: GoogleLeg[] }[];
}

const waypoint = (point: LngLat) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });

function requestBody(request: RouteRequest, options: GoogleRoutesOptions): string {
  const last = request.returnTo ?? request.stops[request.stops.length - 1]!;
  const middle = request.returnTo ? request.stops : request.stops.slice(0, -1);
  return JSON.stringify({
    origin: waypoint(request.origin),
    destination: waypoint(last),
    intermediates: middle.map(waypoint),
    travelMode: options.travelMode ?? "TWO_WHEELER",
    ...(options.trafficAware ? { routingPreference: "TRAFFIC_AWARE" } : {}),
  });
}

export function googleRoutesProvider(options: GoogleRoutesOptions): RoutingProvider {
  const base = trimBase(options.baseUrl ?? DEFAULT_BASE_URL);
  return {
    name: "google-routes",
    async route(request, { fetch, signal }): Promise<ProviderOutcome> {
      if (!options.apiKey) return { ok: false, kind: "unconfigured" };
      const answer = await fetchJson({
        fetch,
        signal,
        url: `${base}/directions/v2:computeRoutes`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": options.apiKey,
            "x-goog-fieldmask": "routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
          },
          body: requestBody(request, options),
        },
      });
      if (!answer.ok) return answer;
      const route = (answer.body as GoogleBody).routes?.[0];
      if (!route) return { ok: false, kind: "no-route" };
      const encoded = route.polyline?.encodedPolyline;
      return routeOutcome(typeof encoded === "string" ? decodePolyline(encoded) : null, legsOf(route.legs, legOf));
    },
  };
}

/** `duration` is a protobuf Duration string, `"123s"` or `"12.5s"`. */
function legOf(leg: GoogleLeg): RouteLeg | null {
  const distanceM = numberOr(leg.distanceMeters, 0);
  const match = typeof leg.duration === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(leg.duration) : null;
  return distanceM === null || !match ? null : { distanceM, durationS: Number(match[1]) };
}
