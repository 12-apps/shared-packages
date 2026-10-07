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
  /**
   * Whether a non-2xx answer means "there is no route between these points"
   * rather than a failed request — read from the status AND the error body,
   * because services reuse a generic status for it (OSRM answers 400).
   */
  isNoRoute?: (status: number, body: unknown) => boolean;
}

export async function fetchJson(call: JsonCall): Promise<{ ok: true; body: unknown } | Failure> {
  let response: Response;
  try {
    response = await call.fetch(call.url, { ...call.init, signal: call.signal });
  } catch (error) {
    return failureOfThrown(error, call.signal) as Failure;
  }
  if (!response.ok && call.isNoRoute) {
    const text = await response.text().catch(() => "");
    if (call.isNoRoute(response.status, parseJson(text))) return { ok: false, kind: "no-route", status: response.status };
    return { ok: false, kind: "http", status: response.status, detail: text.slice(0, 200) };
  }
  const failed = await failureOfResponse(response);
  if (failed) return failed as Failure;
  try {
    return { ok: true, body: (await response.json()) as unknown };
  } catch (error) {
    // An abort while the body streams is the planner's timeout, not a bad body.
    return call.signal.aborted ? (failureOfThrown(error, call.signal) as Failure) : { ok: false, kind: "body" };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
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

/**
 * A base URL without its trailing slashes. A loop rather than `/\/+$/`: that
 * pattern backtracks polynomially on a long run of slashes, and a base URL is
 * host config this package does not control.
 */
export function trimBase(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}
