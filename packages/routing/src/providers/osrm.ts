/**
 * OSRM (`/route/v1/{profile}/{coords}`), self-hosted or a public instance.
 * The public demo server is for testing only — a host that lists it in
 * production should expect to land on the fallback when it rate-limits.
 */

import { waypointsOf, type ProviderOutcome, type RoutingProvider } from "../core/provider";
import type { RouteLeg } from "../core/types";

import { fetchJson, legsOf, positionsOf, routeOutcome } from "./http";

export interface OsrmOptions {
  /** e.g. `https://osrm.example.net`. Empty/absent = `unconfigured`. */
  baseUrl: string | undefined;
  /** OSRM profile segment, `driving` by default. */
  profile?: string;
}

interface OsrmLeg {
  distance?: unknown;
  duration?: unknown;
}

interface OsrmBody {
  code?: unknown;
  routes?: { geometry?: { coordinates?: unknown }; legs?: OsrmLeg[] }[];
}

export function osrmProvider(options: OsrmOptions): RoutingProvider {
  return {
    name: "osrm",
    async route(request, { fetch, signal }): Promise<ProviderOutcome> {
      if (!options.baseUrl) return { ok: false, kind: "unconfigured" };
      const coords = waypointsOf(request)
        .map((point) => `${point.lng},${point.lat}`)
        .join(";");
      const profile = encodeURIComponent(options.profile ?? "driving");
      const url = `${options.baseUrl.replace(/\/+$/, "")}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
      const answer = await fetchJson({ fetch, signal, url, init: { headers: { accept: "application/json" } } });
      if (!answer.ok) return answer;
      const body = answer.body as OsrmBody;
      if (body.code === "NoRoute") return { ok: false, kind: "no-route" };
      if (body.code !== "Ok") return { ok: false, kind: "body" };
      const route = body.routes?.[0];
      return routeOutcome(positionsOf(route?.geometry?.coordinates), legsOf(route?.legs, legOf));
    },
  };
}

function legOf(leg: OsrmLeg): RouteLeg | null {
  return typeof leg.distance === "number" && typeof leg.duration === "number" ? { distanceM: leg.distance, durationS: leg.duration } : null;
}
