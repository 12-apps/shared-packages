import type { RegionMapPoint, RegionMapRegion, RegionMapRing } from './RegionMap.types';

/**
 * The geometry behind `RegionMap`, kept pure so it is tested without a DOM.
 *
 * Coordinates are projected to METRES on a plane around the centre
 * (equirectangular): within the tens of kilometres a map like this spans, its
 * error is far below any outline's own. `y` grows SOUTH, as SVG's does.
 */

/** Metres per degree of latitude on the mean sphere. */
const METRES_PER_DEGREE = 111_195;

/** A projected point, metres east (`x`) and south (`y`) of the centre. */
export interface PlanePoint {
  x: number;
  y: number;
}

/** An SVG viewBox in projected metres. */
export interface PlaneBox {
  /** West edge, metres east of the centre. */
  minX: number;
  /** North edge, metres south of the centre. */
  minY: number;
  /** East-west extent, metres. */
  spanX: number;
  /** North-south extent, metres. */
  spanY: number;
}

export interface Projection {
  project: (point: RegionMapPoint) => PlanePoint;
}

/** The projection around a centre. */
export function projectionAt(center: { latitude: number; longitude: number }): Projection {
  const kx = METRES_PER_DEGREE * Math.cos((center.latitude * Math.PI) / 180);
  return {
    project: ([latitude, longitude]) => ({
      x: (longitude - center.longitude) * kx,
      y: -(latitude - center.latitude) * METRES_PER_DEGREE,
    }),
  };
}

/** A ring as an SVG path segment, closed. */
function ringPath(ring: readonly PlanePoint[]): string {
  if (ring.length === 0) return '';
  const [first, ...rest] = ring;
  return `M${first!.x.toFixed(1)} ${first!.y.toFixed(1)}${rest.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')}Z`;
}

/** Every ring of an area as one path, to be filled with `fill-rule="evenodd"`. */
export function regionPath(rings: readonly (readonly PlanePoint[])[]): string {
  return rings.map(ringPath).join('');
}

/** The smallest and largest of some numbers, in one pass (no spread). */
export function extent(values: Iterable<number>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}

/** The box around projected rings. */
export function planeBounds(rings: readonly (readonly PlanePoint[])[]): PlaneBox | null {
  const points = rings.flat();
  const xs = extent(points.map((p) => p.x));
  const ys = extent(points.map((p) => p.y));
  if (xs === null || ys === null) return null;
  return { minX: xs.min, minY: ys.min, spanX: xs.max - xs.min, spanY: ys.max - ys.min };
}

/**
 * The square the map shows: the largest circle with a margin, else every area,
 * else nothing. Square so the drawing keeps its proportions at every width.
 */
export function viewBoxFor(
  largestRadius: number | null,
  areaBounds: PlaneBox | null,
  margin = 0.12,
): PlaneBox | null {
  if (largestRadius !== null && largestRadius > 0) {
    const half = largestRadius * (1 + margin);
    return { minX: -half, minY: -half, spanX: half * 2, spanY: half * 2 };
  }
  if (areaBounds === null) return null;
  const side = Math.max(areaBounds.spanX, areaBounds.spanY) * (1 + margin) || 1;
  const cx = areaBounds.minX + areaBounds.spanX / 2;
  const cy = areaBounds.minY + areaBounds.spanY / 2;
  return { minX: cx - side / 2, minY: cy - side / 2, spanX: side, spanY: side };
}

/** Do two boxes overlap? Used to skip areas wholly outside the view. */
export function boxesOverlap(a: PlaneBox, b: PlaneBox): boolean {
  return (
    a.minX <= b.minX + b.spanX &&
    b.minX <= a.minX + a.spanX &&
    a.minY <= b.minY + b.spanY &&
    b.minY <= a.minY + a.spanY
  );
}

/** How many of one ring's edges a ray from the point, eastward, crosses. */
function ringCrossings(ring: readonly PlanePoint[], point: PlanePoint): number {
  let crossings = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      crossings += 1;
    }
  }
  return crossings;
}

/** Is the point inside the rings, by the even-odd rule? */
export function ringsContain(rings: readonly (readonly PlanePoint[])[], point: PlanePoint): boolean {
  return rings.reduce((sum, ring) => sum + ringCrossings(ring, point), 0) % 2 === 1;
}

/** The point's distance to one ring's nearest edge. */
function ringDistance(ring: readonly PlanePoint[], point: PlanePoint): number {
  let best = Infinity;
  for (let i = 1; i <= ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y));
  }
  return best;
}

/** The point's distance to the rings: 0 inside, else to the nearest edge. */
export function ringsDistance(rings: readonly (readonly PlanePoint[])[], point: PlanePoint): number {
  if (ringsContain(rings, point)) return 0;
  let best = Infinity;
  for (const ring of rings) best = Math.min(best, ringDistance(ring, point));
  return best;
}

/** An area projected once: what drawing it and hit-testing it read. */
export interface AreaGeometry {
  rings: readonly (readonly PlanePoint[])[];
  /** Null for an area with no points. */
  bounds: PlaneBox | null;
  /** Square metres of the largest ring — orders hits and draw order. */
  area: number;
  /** The SVG path, every ring, for `fill-rule="evenodd"`. */
  path: string;
}

/** A projected area, as the hit test reads it. */
export interface PlaneRegion {
  id: string;
  geometry: AreaGeometry;
}

/** Is the point within `margin` of the box? */
function nearBox(box: PlaneBox, point: PlanePoint, margin: number): boolean {
  return (
    point.x >= box.minX - margin &&
    point.x <= box.minX + box.spanX + margin &&
    point.y >= box.minY - margin &&
    point.y <= box.minY + box.spanY + margin
  );
}

/**
 * Which area a tap at this point means: the SMALLEST area within `tolerance`
 * of it, the ones holding it included (distance 0).
 *
 * Smallest, because a fingertip is wider than a sliver: a tap that lands on a
 * big area a few pixels from a 10 m strip almost always meant the strip, and
 * the big one stays easy to hit everywhere else. An area in another's hole is
 * smaller than the one around it, so it wins too. Nothing within the
 * tolerance — empty map — is nothing: a tap there is not a guess. Areas whose
 * box is not near the point are skipped before any ray is cast.
 */
export function hitRegion(
  regions: readonly PlaneRegion[],
  point: PlanePoint,
  tolerance: number,
): string | null {
  let best: { id: string; area: number; distance: number } | null = null;
  for (const { id, geometry } of regions) {
    const distance = reach(geometry, point, tolerance);
    if (distance !== null && beats(geometry.area, distance, best)) {
      best = { id, area: geometry.area, distance };
    }
  }
  return best?.id ?? null;
}

/** The point's distance to the area, or null when it is beyond the tolerance. */
function reach(geometry: AreaGeometry, point: PlanePoint, tolerance: number): number | null {
  if (geometry.bounds === null || !nearBox(geometry.bounds, point, tolerance)) return null;
  const distance = ringsDistance(geometry.rings, point);
  return distance <= tolerance ? distance : null;
}

/** Smaller wins; between two the same size, the nearer. */
function beats(area: number, distance: number, best: { area: number; distance: number } | null): boolean {
  if (best === null || area < best.area) return true;
  return area === best.area && distance < best.distance;
}

/** Signed area and centroid of one ring (shoelace). */
function ringCentroid(ring: readonly PlanePoint[]): { area: number; x: number; y: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (area === 0) return { area: 0, x: ring[0]?.x ?? 0, y: ring[0]?.y ?? 0 };
  return { area, x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * The area's size in square metres, read from its LARGEST ring. Rough on
 * purpose — holes and second parts are ignored — because it only orders
 * things: which of two areas holding a tap is the smaller, and which is drawn
 * first so a small one is never painted over by its neighbour.
 */
export function planeArea(rings: readonly (readonly PlanePoint[])[]): number {
  let largest = 0;
  for (const ring of rings) largest = Math.max(largest, Math.abs(ringCentroid(ring).area));
  return largest;
}

/**
 * Where an area's label goes: the centroid of its largest ring, pulled back
 * inside the view, as fractions of the view (0..1) — the label is HTML laid
 * over the drawing, so its type stays the theme's size at every width.
 */
export function labelPosition(
  rings: readonly (readonly PlanePoint[])[],
  view: PlaneBox,
  inset = 0.04,
): { fractionX: number; fractionY: number } {
  const largest = rings
    .map(ringCentroid)
    .reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a), { area: 0, x: 0, y: 0 });
  const clamp = (value: number): number => Math.min(1 - inset, Math.max(inset, value));
  return {
    fractionX: clamp((largest.x - view.minX) / view.spanX),
    fractionY: clamp((largest.y - view.minY) / view.spanY),
  };
}

/** Every ring of an area, projected. */
export function projectRings(rings: readonly RegionMapRing[], projection: Projection): PlanePoint[][] {
  return rings.map((ring) => ring.map(projection.project));
}

/** One area's geometry, projected and pathed. */
export function areaGeometry(rings: readonly RegionMapRing[], projection: Projection): AreaGeometry {
  const plane = projectRings(rings, projection);
  return { rings: plane, bounds: planeBounds(plane), area: planeArea(plane), path: regionPath(plane) };
}

/**
 * A cache of geometry per `rings` IDENTITY, for one projection. A host that
 * re-creates its region objects on every toggle (`{ ...area, excluded }`)
 * keeps the same `rings` arrays, so a tap re-projects nothing.
 */
export function geometryCache(projection: Projection): (rings: readonly RegionMapRing[]) => AreaGeometry {
  const cache = new WeakMap<readonly RegionMapRing[], AreaGeometry>();
  return (rings) => {
    let geometry = cache.get(rings);
    if (geometry === undefined) {
      geometry = areaGeometry(rings, projection);
      cache.set(rings, geometry);
    }
    return geometry;
  };
}

/** An area as the drawing reads it. */
export type DrawnRegion = RegionMapRegion & { geometry: AreaGeometry };

/** The areas worth drawing — any part in the view — largest first. */
export function drawOrder(
  regions: readonly RegionMapRegion[],
  geometryOf: (rings: readonly RegionMapRing[]) => AreaGeometry,
  view: PlaneBox,
): DrawnRegion[] {
  return regions
    .map((region) => ({ ...region, geometry: geometryOf(region.rings) }))
    .filter(({ geometry }) => geometry.bounds !== null && boxesOverlap(geometry.bounds, view))
    .sort((a, b) => b.geometry.area - a.geometry.area);
}

/**
 * A Google encoded polyline into `[latitude, longitude]` points, at 1e-5 — the
 * compact form an outline usually travels in. Product-free, so it lives here.
 */
export function decodePolyline(encoded: string, precision = 1e5): RegionMapPoint[] {
  const points: RegionMapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / precision, lng / precision]);
  }
  return points;
}
