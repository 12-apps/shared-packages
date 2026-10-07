/**
 * The adapter port. A routing service plugs in by implementing this — one
 * file under `providers/`, one entry in the host's provider list — and nothing
 * else in the package, or the host, changes.
 *
 * ## An adapter never throws for trouble it can name
 *
 * A routing service being down, slow, out of quota or unable to connect two
 * points is the EXPECTED case the fallback exists for, not an exception. So an
 * adapter answers a discriminated outcome; the planner walks to the next
 * provider on any `ok: false`. A thrown error is still caught (and recorded as
 * a `transport` failure) — a bug in an adapter must not cost the host its
 * route — but no shipped adapter throws on purpose.
 *
 * ## An adapter is stateless and reads no environment
 *
 * Credentials and base URLs arrive in the adapter's own factory options from
 * the HOST, which owns where secrets live. Nothing here reads `process.env`.
 */

import type { ProviderFailureKind, Position, RouteLeg, RouteRequest } from "./types";

/** What the planner hands an adapter for one attempt. */
export interface ProviderContext {
  /** The host's fetch (egress guard, user agent, tracing). */
  fetch: typeof fetch;
  /** Aborts when the planner's per-provider timeout elapses. */
  signal: AbortSignal;
}

export type ProviderOutcome =
  | { ok: true; geometry: Position[]; legs: RouteLeg[] }
  | { ok: false; kind: ProviderFailureKind; status?: number; detail?: string };

export interface RoutingProvider {
  /** Stable identifier, recorded on every route it plans (`"openrouteservice"`). */
  readonly name: string;
  route(request: RouteRequest, context: ProviderContext): Promise<ProviderOutcome>;
}

/** The points of a request in travel order: origin, every stop, the return. */
export function waypointsOf(request: RouteRequest): RouteRequest["origin"][] {
  return [request.origin, ...request.stops, ...(request.returnTo ? [request.returnTo] : [])];
}

/**
 * Turn a fetch into an outcome failure, or `null` when it answered 2xx.
 * Shared by the adapters so every one names timeouts and transport errors
 * the same way.
 */
export async function failureOfResponse(response: Response): Promise<ProviderOutcome | null> {
  if (response.ok) return null;
  const text = await response.text().catch(() => "");
  return { ok: false, kind: "http", status: response.status, detail: text.slice(0, 200) };
}

/** Classify an error a fetch threw: an abort is the planner's timeout. */
export function failureOfThrown(error: unknown, signal: AbortSignal): ProviderOutcome {
  if (signal.aborted) return { ok: false, kind: "timeout" };
  const detail = error instanceof Error ? error.message.slice(0, 200) : undefined;
  return { ok: false, kind: "transport", ...(detail ? { detail } : {}) };
}

/** The number of legs a request has — what a provider's answer must match. */
export function legCountOf(request: RouteRequest): number {
  return waypointsOf(request).length - 1;
}
