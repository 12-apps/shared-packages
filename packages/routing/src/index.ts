/**
 * `@12-apps/routing` — the runtime-neutral core: the vocabulary, the provider
 * port, the planner with its straight-line fallback, and the small geometry
 * both halves share. Backend hosts import `./server`, web hosts `./react`.
 */

export type { LngLat, PlannedRoute, Position, ProviderFailure, ProviderFailureKind, RouteLeg, RouteRequest } from "./core/types";
export type { ProviderContext, ProviderOutcome, RoutingProvider } from "./core/provider";
export { waypointsOf } from "./core/provider";
export { straightRoute } from "./core/fallback";
export { createRoutePlanner, DEFAULT_PROVIDER_TIMEOUT_MS, RouteRequestError } from "./core/planner";
export type { RoutePlanner, RoutePlannerConfig } from "./core/planner";
export { decodePolyline, distanceToLineM, haversineM, isValidPoint } from "./core/geo";
