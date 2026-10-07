import { describe, expect, it, vi } from "vitest";

import { createRoutePlanner, RouteRequestError } from "../core/planner";
import type { ProviderOutcome, RoutingProvider } from "../core/provider";

const REQUEST = { origin: { lng: -46.63, lat: -23.55 }, stops: [{ lng: -46.6, lat: -23.53 }] };
const OK: ProviderOutcome = { ok: true, geometry: [[-46.63, -23.55], [-46.6, -23.53]], legs: [{ distanceM: 4000, durationS: 600 }] };

const provider = (name: string, route: RoutingProvider["route"]): RoutingProvider => ({ name, route });

describe("the planner", () => {
  it("keeps the first provider that answers", async () => {
    const second = vi.fn(async () => OK);
    const plan = createRoutePlanner({ providers: [provider("a", async () => OK), provider("b", second)] });
    await expect(plan(REQUEST)).resolves.toMatchObject({ provider: "a", fallback: false, failures: [] });
    expect(second).not.toHaveBeenCalled();
  });

  it("walks past a failing provider and records why", async () => {
    const plan = createRoutePlanner({
      providers: [provider("a", async () => ({ ok: false, kind: "http", status: 503 })), provider("b", async () => OK)],
    });
    await expect(plan(REQUEST)).resolves.toMatchObject({
      provider: "b",
      failures: [{ provider: "a", kind: "http", status: 503 }],
    });
  });

  it("falls back to straight segments when every provider fails, in the order tried", async () => {
    const plan = createRoutePlanner({
      providers: [
        provider("a", async () => ({ ok: false, kind: "unconfigured" })),
        provider("b", async () => {
          throw new Error("socket hang up");
        }),
      ],
    });
    const route = await plan(REQUEST);
    expect(route).toMatchObject({ provider: null, fallback: true });
    expect(route.failures).toEqual([
      { provider: "a", kind: "unconfigured" },
      { provider: "b", kind: "transport", detail: "socket hang up" },
    ]);
    expect(route.legs[0]?.durationS).toBeNull();
  });

  it("falls back with no providers at all", async () => {
    await expect(createRoutePlanner({ providers: [] })(REQUEST)).resolves.toMatchObject({ fallback: true, failures: [] });
  });

  it("times a slow provider out instead of waiting for it", async () => {
    const slow = provider(
      "slow",
      (_request, { signal }) =>
        new Promise<ProviderOutcome>((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, kind: "timeout" }));
        }),
    );
    const route = await createRoutePlanner({ providers: [slow], timeoutMs: 10 })(REQUEST);
    expect(route.failures).toEqual([{ provider: "slow", kind: "timeout" }]);
  });

  it("times out a provider that ignores the abort signal, instead of hanging", async () => {
    const deaf = provider("deaf", () => new Promise<ProviderOutcome>(() => undefined));
    const route = await createRoutePlanner({ providers: [deaf], timeoutMs: 10 })(REQUEST);
    expect(route).toMatchObject({ fallback: true, failures: [{ provider: "deaf", kind: "timeout" }] });
  });

  it("records an adapter that throws synchronously as a transport failure", async () => {
    const broken = provider("broken", () => {
      throw new Error("boom");
    });
    const route = await createRoutePlanner({ providers: [broken] })(REQUEST);
    expect(route.failures).toEqual([{ provider: "broken", kind: "transport", detail: "boom" }]);
  });

  it("treats a 2xx with the wrong number of legs as an unreadable body", async () => {
    const plan = createRoutePlanner({ providers: [provider("a", async () => ({ ...OK, legs: [] }))] });
    const route = await plan(REQUEST);
    expect(route.fallback).toBe(true);
    expect(route.failures[0]).toMatchObject({ provider: "a", kind: "body" });
  });

  it("refuses a request it cannot route, and a provider listed twice", async () => {
    const plan = createRoutePlanner({ providers: [] });
    await expect(plan({ origin: REQUEST.origin, stops: [] })).rejects.toBeInstanceOf(RouteRequestError);
    await expect(plan({ origin: { lng: 0, lat: 0 }, stops: REQUEST.stops })).rejects.toBeInstanceOf(RouteRequestError);
    expect(() => createRoutePlanner({ providers: [provider("a", async () => OK), provider("a", async () => OK)] })).toThrow(
      RouteRequestError,
    );
  });
});
