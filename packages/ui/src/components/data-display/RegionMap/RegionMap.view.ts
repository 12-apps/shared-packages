import {
  extent,
  planeBounds,
  projectionAt,
  projectRings,
  viewBoxFor,
  type PlaneBox,
  type Projection,
} from './RegionMap.helpers';
import type {
  RegionMapBounds,
  RegionMapCircle,
  RegionMapReach,
  RegionMapRegion,
  RegionMapRing,
} from './RegionMap.types';

// What `RegionMap` shows: its view, given the circles, the areas and a host's
// `reach` — pure, so a host laying HTML over the drawing computes the same one.

/** The smallest box holding every given box, or null with none. */
export function unionBox(boxes: readonly (PlaneBox | null)[]): PlaneBox | null {
  const real = boxes.filter((box): box is PlaneBox => box !== null);
  const xs = extent(real.flatMap((b) => [b.minX, b.minX + b.spanX]));
  const ys = extent(real.flatMap((b) => [b.minY, b.minY + b.spanY]));
  if (xs === null || ys === null) return null;
  return { minX: xs.min, minY: ys.min, spanX: xs.max - xs.min, spanY: ys.max - ys.min };
}

/** The latitude/longitude box around some outlines — a `reach` no radius describes. */
export function boundsOfRings(rings: readonly RegionMapRing[]): RegionMapBounds | null {
  const points = rings.flat();
  const lats = extent(points.map(([latitude]) => latitude));
  const lngs = extent(points.map(([, longitude]) => longitude));
  if (lats === null || lngs === null) return null;
  return { south: lats.min, west: lngs.min, north: lats.max, east: lngs.max };
}

/** A `reach` as a box in projected metres (a radius is a square around the centre). */
export function reachBox(reach: RegionMapReach, projection: Projection): PlaneBox | null {
  if ('radiusMetres' in reach) {
    const r = reach.radiusMetres;
    return Number.isFinite(r) && r > 0 ? { minX: -r, minY: -r, spanX: r * 2, spanY: r * 2 } : null;
  }
  const { south, west, north, east } = reach.bounds;
  const a = projection.project([north, west]);
  const b = projection.project([south, east]);
  return unionBox([{ minX: a.x, minY: a.y, spanX: 0, spanY: 0 }, { minX: b.x, minY: b.y, spanX: 0, spanY: 0 }]);
}

/** How far the box reaches from the centre along either axis — the half-side of a centred square holding it. */
function farthestEdge(box: PlaneBox): number {
  return Math.max(Math.abs(box.minX), Math.abs(box.minX + box.spanX), Math.abs(box.minY), Math.abs(box.minY + box.spanY));
}

/**
 * The view, given what it must fit: the outermost circle and the `reach` with
 * the margin on top, still centred on the centre; else every area and the
 * reach together. Without a reach it is exactly `viewBoxFor`'s.
 */
export function viewWithin(
  outermostMetres: number | null,
  reach: PlaneBox | null,
  areaBoxes: () => readonly (PlaneBox | null)[],
): PlaneBox | null {
  if (outermostMetres !== null) {
    return viewBoxFor(Math.max(outermostMetres, reach === null ? 0 : farthestEdge(reach)), null);
  }
  return viewBoxFor(null, unionBox([...areaBoxes(), reach]));
}

/** The middle of every area, for a map with no centre of its own. */
export function centreOf(regions: readonly RegionMapRegion[]): { latitude: number; longitude: number } | null {
  const bounds = boundsOfRings(regions.flatMap((r) => r.rings));
  if (bounds === null) return null;
  return { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 };
}

/**
 * The square `RegionMap` shows for these props, in projected metres around
 * `center` (or the areas' middle) — for a host that lays its own HTML over the
 * drawing at the same scale: a point `p` sits at
 * `(p.x - view.minX) / view.spanX` across. With circles the view is centred,
 * so its half-side is `view.spanX / 2`.
 */
export function regionMapView({
  regions,
  center,
  circles = [],
  reach,
}: {
  regions: readonly RegionMapRegion[];
  center: { latitude: number; longitude: number } | null;
  circles?: readonly RegionMapCircle[];
  reach?: RegionMapReach;
}): PlaneBox | null {
  const origin = center ?? centreOf(regions);
  if (origin === null) return null;
  const projection = projectionAt(origin);
  return viewWithin(
    extent(circles.map((c) => c.radiusMetres))?.max ?? null,
    reach === undefined ? null : reachBox(reach, projection),
    () => regions.map((r) => planeBounds(projectRings(r.rings, projection))),
  );
}
