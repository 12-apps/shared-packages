import { describe, expect, it } from "vitest";

import { createApiRouting, parseRouteRequest } from "../server/index";

const BODY = { origin: { lng: -46.63, lat: -23.55 }, stops: [{ lng: -46.6, lat: -23.53 }] };
const call = (api: ReturnType<typeof createApiRouting<string>>, actor: string, body: unknown) =>
  api.routes[0]!.handle({ actor, params: {}, query: {}, body });

describe("createApiRouting", () => {
  const api = createApiRouting<string>({ providers: [], authorize: (actor) => actor === "staff" });

  it("exposes one POST /route and the in-process planner", () => {
    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual(["POST /route"]);
    expect(typeof api.planRoute).toBe("function");
  });

  it("refuses an actor the host does not authorise", async () => {
    await expect(call(api, "guest", BODY)).resolves.toMatchObject({ status: 403 });
  });

  it("refuses a malformed body, and answers a route for a good one", async () => {
    await expect(call(api, "staff", { origin: BODY.origin, stops: [] })).resolves.toMatchObject({ status: 400 });
    const answer = await call(api, "staff", BODY);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ fallback: true, provider: null });
  });

  it("never hands the caller a provider's raw error text", async () => {
    const leaky = createApiRouting<string>({
      providers: [{ name: "osrm", route: async () => ({ ok: false, kind: "transport", detail: "getaddrinfo ENOTFOUND osrm.internal" }) }],
      authorize: () => true,
    });
    const answer = await call(leaky, "staff", BODY);
    expect((answer.body as { failures: unknown[] }).failures).toEqual([{ provider: "osrm", kind: "transport" }]);
    await expect(leaky.planRoute(BODY)).resolves.toMatchObject({ failures: [{ detail: "getaddrinfo ENOTFOUND osrm.internal" }] });
  });

  it("reads a null returnTo as absent", () => {
    expect(parseRouteRequest({ ...BODY, returnTo: null })).toMatchObject({ ok: true });
  });

  it("caps the stops a caller may send", () => {
    const stops = Array.from({ length: 3 }, () => BODY.stops[0]);
    expect(parseRouteRequest({ ...BODY, stops }, 2)).toEqual({ ok: false, error: "at most 2 stops" });
  });

  it("will not build without an authorize", () => {
    expect(() => createApiRouting({ providers: [] } as never)).toThrow(TypeError);
  });

  it("refuses 0,0 and non-numeric points", () => {
    expect(parseRouteRequest({ origin: { lng: 0, lat: 0 }, stops: BODY.stops }).ok).toBe(false);
    expect(parseRouteRequest({ origin: { lng: "1", lat: "2" }, stops: BODY.stops }).ok).toBe(false);
    expect(parseRouteRequest({ ...BODY, returnTo: { lng: 1 } }).ok).toBe(false);
  });
});
