import { describe, expect, it, vi } from "vitest";

import { googleRoutesProvider } from "../providers/google";
import { openRouteServiceProvider } from "../providers/openrouteservice";
import { osrmProvider } from "../providers/osrm";

const REQUEST = { origin: { lng: -46.63, lat: -23.55 }, stops: [{ lng: -46.6, lat: -23.53 }], returnTo: { lng: -46.63, lat: -23.55 } };
const LINE = [
  [-46.63, -23.55],
  [-46.6, -23.53],
  [-46.63, -23.55],
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const context = (fetch: typeof globalThis.fetch) => ({ fetch, signal: new AbortController().signal });

describe("openrouteservice", () => {
  const ors = (apiKey: string | undefined = "key") => openRouteServiceProvider({ apiKey });

  it("posts every waypoint in order and reads the line and one segment per leg", async () => {
    const fetch = vi.fn(async () =>
      json({ features: [{ geometry: { coordinates: LINE }, properties: { segments: [{ distance: 4200, duration: 620 }, { distance: 4100, duration: 600 }] } }] }),
    );
    await expect(ors().route(REQUEST, context(fetch))).resolves.toEqual({
      ok: true,
      geometry: LINE,
      legs: [
        { distanceM: 4200, durationS: 620 },
        { distanceM: 4100, durationS: 600 },
      ],
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openrouteservice.org/v2/directions/driving-car/geojson");
    expect(JSON.parse(String(init.body))).toEqual({ coordinates: LINE });
    expect((init.headers as Record<string, string>).authorization).toBe("key");
  });

  it("names its failures instead of throwing", async () => {
    await expect(ors("").route(REQUEST, context(vi.fn()))).resolves.toEqual({ ok: false, kind: "unconfigured" });
    await expect(ors().route(REQUEST, context(vi.fn(async () => json({ error: { code: 2009, message: "Route could not be found" } }, 404))))).resolves.toMatchObject({
      kind: "no-route",
      status: 404,
    });
    // A 404 without the routing code is a wrong profile or URL, not "no route".
    await expect(ors().route(REQUEST, context(vi.fn(async () => json({ error: "Not Found" }, 404))))).resolves.toMatchObject({ kind: "http", status: 404 });
    await expect(ors().route(REQUEST, context(vi.fn(async () => json({ error: "quota" }, 429))))).resolves.toMatchObject({
      ok: false,
      kind: "http",
      status: 429,
    });
    await expect(ors().route(REQUEST, context(vi.fn(async () => json({ features: [] }))))).resolves.toMatchObject({ kind: "body" });
    await expect(
      ors().route(
        REQUEST,
        context(
          vi.fn(async () => {
            throw new TypeError("fetch failed");
          }),
        ),
      ),
    ).resolves.toMatchObject({ kind: "transport" });
  });
});

describe("the shared http step", () => {
  it("names a timeout while the body streams as a timeout, not a bad body", async () => {
    const controller = new AbortController();
    const response = new Response(JSON.stringify({}), { status: 200 });
    vi.spyOn(response, "json").mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const outcome = await openRouteServiceProvider({ apiKey: "k" }).route(REQUEST, { fetch: vi.fn(async () => response), signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, kind: "timeout" });
  });
});

describe("osrm", () => {
  it("reads routes[0] and its legs", async () => {
    const fetch = vi.fn(async () =>
      json({ code: "Ok", routes: [{ geometry: { coordinates: LINE }, legs: [{ distance: 1, duration: 2 }, { distance: 3, duration: 4 }] }] }),
    );
    await expect(osrmProvider({ baseUrl: "https://osrm.test/" }).route(REQUEST, context(fetch))).resolves.toMatchObject({
      ok: true,
      legs: [
        { distanceM: 1, durationS: 2 },
        { distanceM: 3, durationS: 4 },
      ],
    });
    expect(String((fetch.mock.calls[0] as unknown as [string])[0])).toBe(
      "https://osrm.test/route/v1/driving/-46.63,-23.55;-46.6,-23.53;-46.63,-23.55?overview=full&geometries=geojson&steps=false",
    );
  });

  it("names NoRoute and a missing base URL", async () => {
    // Real OSRM answers an impossible route with HTTP 400 and the code in the body.
    for (const code of ["NoRoute", "NoSegment"]) {
      await expect(osrmProvider({ baseUrl: "https://osrm.test" }).route(REQUEST, context(vi.fn(async () => json({ code }, 400))))).resolves.toMatchObject({
        kind: "no-route",
        status: 400,
      });
    }
    await expect(osrmProvider({ baseUrl: "https://osrm.test" }).route(REQUEST, context(vi.fn(async () => json({ code: "InvalidQuery" }, 400))))).resolves.toMatchObject({
      kind: "http",
      status: 400,
    });
    await expect(osrmProvider({ baseUrl: undefined }).route(REQUEST, context(vi.fn()))).resolves.toMatchObject({ kind: "unconfigured" });
  });
});

describe("google routes", () => {
  it("sends origin, intermediates and destination, and decodes the line", async () => {
    const fetch = vi.fn(async () =>
      json({ routes: [{ polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC" }, legs: [{ distanceMeters: 10, duration: "12s" }, { distanceMeters: 20, duration: "7.5s" }] }] }),
    );
    const outcome = await googleRoutesProvider({ apiKey: "k" }).route(REQUEST, context(fetch));
    expect(outcome).toMatchObject({ ok: true, legs: [{ distanceM: 10, durationS: 12 }, { distanceM: 20, durationS: 7.5 }] });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.intermediates).toHaveLength(1);
    expect(body.destination.location.latLng).toEqual({ latitude: -23.55, longitude: -46.63 });
    expect(body.travelMode).toBe("TWO_WHEELER");
  });

  it("reads an empty answer as no route and a bad duration as an unreadable body", async () => {
    const provider = googleRoutesProvider({ apiKey: "k" });
    await expect(provider.route(REQUEST, context(vi.fn(async () => json({}))))).resolves.toMatchObject({ kind: "no-route" });
    await expect(
      provider.route(REQUEST, context(vi.fn(async () => json({ routes: [{ polyline: { encodedPolyline: "_p~iF~ps|U" }, legs: [{ duration: "soon" }] }] })))),
    ).resolves.toMatchObject({ kind: "body" });
    await expect(googleRoutesProvider({ apiKey: "" }).route(REQUEST, context(vi.fn()))).resolves.toMatchObject({ kind: "unconfigured" });
  });
});
