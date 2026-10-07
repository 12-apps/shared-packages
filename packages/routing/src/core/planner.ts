/**
 * The planner: try each configured provider in the host's order, keep the
 * first route that comes back, and fall back to straight segments when none
 * does. It never throws for a provider's trouble — the only refusals are a
 * request that cannot be routed at all (fewer than two valid points), which is
 * the caller's bug, and a provider list with two adapters of the same name.
 */

import { straightRoute } from "./fallback";
import { isValidPoint } from "./geo";
import { failureOfThrown, legCountOf, waypointsOf, type ProviderOutcome, type RoutingProvider } from "./provider";
import type { PlannedRoute, ProviderFailure, RouteRequest } from "./types";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 6_000;

export interface RoutePlannerConfig {
  /** Tried in this order; the first that answers wins. Empty = always the fallback. */
  providers: readonly RoutingProvider[];
  /** Per-provider budget. A provider that exceeds it is a `timeout` failure. */
  timeoutMs?: number;
  /** The host's fetch. Defaults to the global one. */
  fetch?: typeof fetch;
}

export type RoutePlanner = (request: RouteRequest) => Promise<PlannedRoute>;

export class RouteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteRequestError";
  }
}

export function createRoutePlanner(config: RoutePlannerConfig): RoutePlanner {
  assertUniqueNames(config.providers);
  const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const doFetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return async (request) => {
    assertRoutable(request);
    const failures: ProviderFailure[] = [];
    for (const provider of config.providers) {
      const outcome = await attempt(provider, request, doFetch, timeoutMs);
      if (outcome.ok) return { geometry: outcome.geometry, legs: outcome.legs, provider: provider.name, fallback: false, failures };
      failures.push({
        provider: provider.name,
        kind: outcome.kind,
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      });
    }
    return straightRoute(request, failures);
  };
}

async function attempt(
  provider: RoutingProvider,
  request: RouteRequest,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<ProviderOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timer RACES the adapter rather than only aborting it: an adapter (or
  // a host fetch wrapper) that ignores the signal must not hang the planner,
  // or "there is always a route" stops being true.
  const timedOut = new Promise<ProviderOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, kind: "timeout" });
    }, timeoutMs);
  });
  // `Promise.resolve().then` so an adapter that throws synchronously is
  // caught like one that rejects.
  const answered = Promise.resolve()
    .then(() => provider.route(request, { fetch: doFetch, signal: controller.signal }))
    .then((outcome) => (outcome.ok ? checkShape(outcome, request) : outcome))
    .catch((error: unknown) => failureOfThrown(error, controller.signal));
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** A 2xx with the wrong number of legs, or no line, is an unreadable body. */
function checkShape(outcome: Extract<ProviderOutcome, { ok: true }>, request: RouteRequest): ProviderOutcome {
  if (outcome.geometry.length < 2) return { ok: false, kind: "body", detail: "empty geometry" };
  if (outcome.legs.length !== legCountOf(request)) {
    return { ok: false, kind: "body", detail: `expected ${legCountOf(request)} legs, got ${outcome.legs.length}` };
  }
  return outcome;
}

function assertRoutable(request: RouteRequest): void {
  const points = waypointsOf(request);
  if (points.length < 2) throw new RouteRequestError("a route needs an origin and at least one stop");
  if (!points.every((point) => isValidPoint(point))) throw new RouteRequestError("every waypoint must be a valid point");
}

function assertUniqueNames(providers: readonly RoutingProvider[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.name)) throw new RouteRequestError(`provider "${provider.name}" is listed twice`);
    seen.add(provider.name);
  }
}
