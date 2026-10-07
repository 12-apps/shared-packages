/**
 * `@12-apps/routing/server` — the one thing this package exposes to a BACKEND
 * host: `createApiRouting(config) → { routes, planRoute }`.
 *
 * - `planRoute` is the planner itself, for a host that plans in-process (a job
 *   that saves a route when a trip starts): no HTTP hop, same fallback.
 * - `routes` is one framework-neutral descriptor, `POST /route`, for a host
 *   that lets a client ask for a route. Who may ask is the host's
 *   `authorize` — the package has no idea what a caller is.
 *
 * Which services are tried, and in what order, is the provider list the host
 * passes: swapping openrouteservice for OSRM, or adding a new adapter, is a
 * config change here and nowhere else.
 */

import { isValidPoint } from "../core/geo";
import { createRoutePlanner, type RoutePlanner, type RoutePlannerConfig } from "../core/planner";
import type { LngLat, RouteRequest } from "../core/types";

export interface RoutingRequest<TActor> {
  actor: TActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

export interface RoutingResponse {
  status: number;
  body: unknown;
}

export interface RoutingRoute<TActor> {
  method: "POST";
  path: string;
  handle(request: RoutingRequest<TActor>): Promise<RoutingResponse>;
}

export interface RoutingServerConfig<TActor = unknown> extends RoutePlannerConfig {
  /** Answer whether this actor may plan a route. Required: there is no default. */
  authorize(actor: TActor): boolean | Promise<boolean>;
  /** Upper bound on stops per request (default 25) — a provider bills per waypoint. */
  maxStops?: number;
}

export interface RoutingApi<TActor> {
  routes: RoutingRoute<TActor>[];
  planRoute: RoutePlanner;
}

const DEFAULT_MAX_STOPS = 25;

export function createApiRouting<TActor = unknown>(config: RoutingServerConfig<TActor>): RoutingApi<TActor> {
  if (typeof config.authorize !== "function") throw new TypeError("createApiRouting: `authorize` is required");
  const planRoute = createRoutePlanner(config);
  const maxStops = config.maxStops ?? DEFAULT_MAX_STOPS;
  const route: RoutingRoute<TActor> = {
    method: "POST",
    path: "/route",
    async handle(request) {
      if (!(await config.authorize(request.actor))) return { status: 403, body: { error: "forbidden" } };
      const parsed = parseRouteRequest(request.body, maxStops);
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
      return { status: 200, body: await planRoute(parsed.request) };
    },
  };
  return { routes: [route], planRoute };
}

type Parsed = { ok: true; request: RouteRequest } | { ok: false; error: string };

/** A finite, non-0,0 point from an untrusted value, or `null`. */
function pointOf(value: unknown): LngLat | null {
  if (typeof value !== "object" || value === null) return null;
  const { lng, lat } = value as Record<string, unknown>;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  const candidate = { lng, lat };
  return isValidPoint(candidate) ? candidate : null;
}

function stopsOf(value: unknown, maxStops: number): LngLat[] | string {
  if (!Array.isArray(value) || value.length === 0) return "stops must be a non-empty array";
  if (value.length > maxStops) return `at most ${maxStops} stops`;
  const stops = value.map(pointOf);
  return stops.every((stop): stop is LngLat => stop !== null) ? stops : "every stop must be a valid point";
}

/** Validate an untrusted body into a request; never trust a client's points. */
export function parseRouteRequest(body: unknown, maxStops = DEFAULT_MAX_STOPS): Parsed {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };
  const { origin, stops, returnTo } = body as Record<string, unknown>;
  const from = pointOf(origin);
  if (!from) return { ok: false, error: "origin must be a valid point" };
  const parsedStops = stopsOf(stops, maxStops);
  if (typeof parsedStops === "string") return { ok: false, error: parsedStops };
  const back = returnTo === undefined ? undefined : pointOf(returnTo);
  if (back === null) return { ok: false, error: "returnTo must be a valid point" };
  return { ok: true, request: { origin: from, stops: parsedStops, ...(back ? { returnTo: back } : {}) } };
}

export { openRouteServiceProvider, type OpenRouteServiceOptions } from "../providers/openrouteservice";
export { osrmProvider, type OsrmOptions } from "../providers/osrm";
export { googleRoutesProvider, type GoogleRoutesOptions } from "../providers/google";
export { createRoutePlanner, DEFAULT_PROVIDER_TIMEOUT_MS, RouteRequestError } from "../core/planner";
export type { RoutePlanner, RoutePlannerConfig } from "../core/planner";
