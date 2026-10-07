import { describe, expect, it } from "vitest";

import { straightRoute } from "../core/fallback";
import { decodePolyline, distanceToLineM, haversineM, isValidPoint } from "../core/geo";

const SAO_PAULO = { lng: -46.6333, lat: -23.5505 };
const RIO = { lng: -43.1729, lat: -22.9068 };

describe("geometry", () => {
  it("measures a great-circle distance", () => {
    expect(haversineM(SAO_PAULO, RIO) / 1000).toBeCloseTo(361, 0);
    expect(haversineM(SAO_PAULO, SAO_PAULO)).toBe(0);
  });

  it("refuses 0,0, out-of-range and non-finite points", () => {
    expect(isValidPoint(SAO_PAULO)).toBe(true);
    expect(isValidPoint({ lng: 0, lat: 0 })).toBe(false);
    expect(isValidPoint({ lng: 181, lat: 0 })).toBe(false);
    expect(isValidPoint({ lng: Number.NaN, lat: 1 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });

  it("measures the distance from a point to a line", () => {
    const line = [
      [-46.64, -23.55],
      [-46.62, -23.55],
    ] as const;
    expect(distanceToLineM({ lng: -46.63, lat: -23.55 }, line)).toBeLessThan(1);
    expect(distanceToLineM({ lng: -46.63, lat: -23.551 }, line)).toBeCloseTo(111, -1);
    expect(distanceToLineM(SAO_PAULO, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("decodes an encoded polyline into [lng, lat], and refuses a broken one", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
    expect(decodePolyline("_p~iF~ps|U_")).toBeNull();
  });
});

describe("the straight-line fallback", () => {
  it("draws straight segments in order, with distances and no durations", () => {
    const route = straightRoute({ origin: SAO_PAULO, stops: [RIO], returnTo: SAO_PAULO });
    expect(route.geometry).toEqual([
      [SAO_PAULO.lng, SAO_PAULO.lat],
      [RIO.lng, RIO.lat],
      [SAO_PAULO.lng, SAO_PAULO.lat],
    ]);
    expect(route.legs).toHaveLength(2);
    expect(route.legs.every((leg) => leg.durationS === null && leg.distanceM > 300_000)).toBe(true);
    expect(route).toMatchObject({ provider: null, fallback: true, failures: [] });
  });
});
