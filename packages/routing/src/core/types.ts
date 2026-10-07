/**
 * The vocabulary every half of `@12-apps/routing` speaks. No provider word
 * escapes an adapter: whatever a routing service calls its pieces, the planner
 * hands the host these shapes and nothing else.
 */

/** A point on the map, WGS84 degrees. Longitude first in every array form. */
export interface LngLat {
  lng: number;
  lat: number;
}

/** `[lng, lat]` — the GeoJSON order, which is also what MapLibre draws. */
export type Position = readonly [number, number];

/**
 * What to route: from `origin`, through every stop IN THE ORDER GIVEN, and
 * optionally back to `returnTo`. The planner never reorders stops — sequencing
 * is the host's decision (a dispatcher may have moved one by hand).
 */
export interface RouteRequest {
  origin: LngLat;
  stops: readonly LngLat[];
  returnTo?: LngLat;
}

/**
 * One leg between consecutive points: origin → stop 1, stop 1 → stop 2, …,
 * last stop → `returnTo`. `durationS` is `null` when nobody measured it — the
 * straight-line fallback knows a distance, never a time.
 */
export interface RouteLeg {
  distanceM: number;
  durationS: number | null;
}

/** A failure the planner recorded on its way to an answer. */
export interface ProviderFailure {
  provider: string;
  kind: ProviderFailureKind;
  /** HTTP status when the service answered with one. */
  status?: number;
  /** A short, non-secret explanation for logs — never shown to an end user. */
  detail?: string;
}

export type ProviderFailureKind =
  /** No credential or base URL was configured for this provider. */
  | "unconfigured"
  /** The service answered with a non-2xx status. */
  | "http"
  /** The request did not finish inside the planner's timeout. */
  | "timeout"
  /** The request never got an answer (DNS, refused, reset, egress guard). */
  | "transport"
  /** The service answered 2xx with a body this adapter cannot read. */
  | "body"
  /** The service found no route between the points. */
  | "no-route";

/**
 * The planner's answer. Always present: when every provider failed (or none
 * is configured) it is the straight-line fallback, flagged as such, with the
 * failures that led there.
 */
export interface PlannedRoute {
  /** The drawn line, `[lng, lat][]`, origin first. */
  geometry: Position[];
  /** One entry per leg, in request order. */
  legs: RouteLeg[];
  /** The provider that answered, or `null` for the fallback. */
  provider: string | null;
  /** `true` when the line is straight segments between the points. */
  fallback: boolean;
  /** Every provider that was tried and failed, in the order tried. */
  failures: ProviderFailure[];
}
