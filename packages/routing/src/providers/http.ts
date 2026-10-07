/**
 * The one HTTP step every adapter shares: call, classify the failure, parse
 * JSON. An adapter only knows its URL, its body and how to read its answer.
 */

import { failureOfResponse, failureOfThrown, type ProviderOutcome } from "../core/provider";
import type { Position, RouteLeg } from "../core/types";

type Failure = Extract<ProviderOutcome, { ok: false }>;

interface JsonCall {
  fetch: typeof fetch;
  signal: AbortSignal;
  url: string;
  init?: RequestInit;
  /** Statuses the service uses for "there is no route between these points". */
  noRouteStatuses?: readonly number[];
}

export async function fetchJson(call: JsonCall): Promise<{ ok: true; body: unknown } | Failure> {
  let response: Response;
  try {
    response = await call.fetch(call.url, { ...call.init, signal: call.signal });
  } catch (error) {
    return failureOfThrown(error, call.signal) as Failure;
  }
  if (call.noRouteStatuses?.includes(response.status)) return { ok: false, kind: "no-route", status: response.status };
  const failed = await failureOfResponse(response);
  if (failed) return failed as Failure;
  const body: unknown = await response.json().catch(() => undefined);
  return body === undefined ? { ok: false, kind: "body" } : { ok: true, body };
}

/** `[lng, lat][]` from an untrusted value, or `null`. */
export function positionsOf(value: unknown): Position[] | null {
  if (!Array.isArray(value)) return null;
  const out: Position[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || typeof item[0] !== "number" || typeof item[1] !== "number") return null;
    out.push([item[0], item[1]]);
  }
  return out;
}

/** Every leg read, or `null` when any one is unreadable. */
export function legsOf<T>(items: readonly T[] | undefined, read: (item: T) => RouteLeg | null): RouteLeg[] | null {
  if (!items) return null;
  const legs = items.map(read);
  return legs.every((leg): leg is RouteLeg => leg !== null) ? legs : null;
}

/** The success outcome, or an unreadable-body failure when either part is missing. */
export function routeOutcome(geometry: Position[] | null, legs: RouteLeg[] | null): ProviderOutcome {
  return geometry && legs ? { ok: true, geometry, legs } : { ok: false, kind: "body" };
}

/** A number, with a missing value read as `fallback` (services omit zero-length legs). */
export const numberOr = (value: unknown, fallback: number): number | null =>
  value === undefined ? fallback : typeof value === "number" ? value : null;
