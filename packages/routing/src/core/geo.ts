/**
 * The little geometry the package needs, and nothing more: the great-circle
 * distance the fallback measures with, the distance from a point to a drawn
 * line (how far someone is from the route they were given), and the decoder
 * for Google's encoded polyline.
 */

import type { LngLat, Position } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `true` for a finite WGS84 point — and never the 0,0 a missing value turns into. */
export function isValidPoint(point: LngLat | null | undefined): point is LngLat {
  if (!point) return false;
  const { lng, lat } = point;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  return !(lng === 0 && lat === 0);
}

export const toPosition = (point: LngLat): Position => [point.lng, point.lat];

const fromPosition = ([lng, lat]: Position): LngLat => ({ lng, lat });

/**
 * Shortest distance, in metres, from `point` to the polyline `line`.
 *
 * Each segment is projected in a local equirectangular plane around the point
 * — exact enough at street scale (a few metres over a city), and far cheaper
 * than the spherical formula a per-fix check would otherwise pay. An empty line
 * is infinitely far; a one-point line is that point.
 */
export function distanceToLineM(point: LngLat, line: readonly Position[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineM(point, fromPosition(line[0]!));
  const cosLat = Math.cos(toRad(point.lat));
  const project = ([lng, lat]: Position): [number, number] => [
    toRad(lng - point.lng) * cosLat * EARTH_RADIUS_M,
    toRad(lat - point.lat) * EARTH_RADIUS_M,
  ];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = project(line[i - 1]!);
    const [bx, by] = project(line[i]!);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * Decode an encoded polyline (precision 5) into `[lng, lat]` positions.
 * Returns `null` on a malformed string rather than a half-decoded line.
 */
export function decodePolyline(encoded: string, precision = 5): Position[] | null {
  const factor = 10 ** precision;
  const positions: Position[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    positions.push([lng / factor, lat / factor]);
  }
  return positions;
}
