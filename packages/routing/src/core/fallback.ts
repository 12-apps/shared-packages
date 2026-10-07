/**
 * The route every request gets when no service answered: straight segments
 * between the points, in the order given, with great-circle distances and NO
 * durations. A straight line is an honest picture of the order of stops; a
 * time computed from it would be an invention, so there is none.
 */

import { haversineM, toPosition } from "./geo";
import { waypointsOf } from "./provider";
import type { PlannedRoute, ProviderFailure, RouteRequest } from "./types";

export function straightRoute(request: RouteRequest, failures: ProviderFailure[] = []): PlannedRoute {
  const points = waypointsOf(request);
  const legs = points.slice(1).map((point, i) => ({ distanceM: haversineM(points[i]!, point), durationS: null }));
  return { geometry: points.map(toPosition), legs, provider: null, fallback: true, failures };
}
