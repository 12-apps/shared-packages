import React from 'react';

import {
  drawOrder,
  extent,
  geometryCache,
  hitRegion,
  projectionAt,
  viewBoxFor,
  type DrawnRegion,
  type PlaneBox,
} from './RegionMap.helpers';
import type { RegionMapProps, RegionMapRegion } from './RegionMap.types';

/** What the drawing needs, derived from the props. */
export interface RegionMapModel {
  /** The square shown, or null when there is nothing to centre on. */
  view: PlaneBox | null;
  drawn: DrawnRegion[];
  /** Radii drawn, in metres; empty without circles. */
  radii: number[];
  outermostMetres: number | null;
  /** The tap handlers for the drawing's `<svg>`. */
  onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void;
  onClick: (event: React.MouseEvent<SVGSVGElement>) => void;
}

/** A tap reaches an area this close: a share of the view (~8 px on a phone). */
const TOLERANCE_SHARE = 1 / 45;

/** The middle of every area, for a map with no centre of its own. */
function centreOf(regions: readonly RegionMapRegion[]): { latitude: number; longitude: number } | null {
  const points = regions.flatMap((r) => r.rings.flat());
  const lats = extent(points.map(([lat]) => lat));
  const lngs = extent(points.map(([, lng]) => lng));
  if (lats === null || lngs === null) return null;
  return { latitude: (lats.min + lats.max) / 2, longitude: (lngs.min + lngs.max) / 2 };
}

/** The click, in the drawing's own coordinates — or null where it cannot be read. */
function svgPoint(event: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null {
  const svg = event.currentTarget;
  const matrix = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!matrix || typeof DOMPoint === 'undefined') return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/** The view: the outermost circle when there is one, else every area's box. */
function viewOf(outermostMetres: number | null, drawable: () => (PlaneBox | null)[]): PlaneBox | null {
  if (outermostMetres !== null) return viewBoxFor(outermostMetres, null);
  const boxes = drawable().filter((box): box is PlaneBox => box !== null);
  const xs = extent(boxes.flatMap((b) => [b.minX, b.minX + b.spanX]));
  const ys = extent(boxes.flatMap((b) => [b.minY, b.minY + b.spanY]));
  if (xs === null || ys === null) return null;
  return viewBoxFor(null, { minX: xs.min, minY: ys.min, spanX: xs.max - xs.min, spanY: ys.max - ys.min });
}

/** Which area a click or tap means — see `useRegionMap`. */
function tappedRegion(
  event: React.MouseEvent<SVGSVGElement>,
  pointer: string,
  drawn: readonly DrawnRegion[],
  view: PlaneBox,
): string | null {
  const targetId = (event.target as Element).getAttribute('data-region-id');
  if (pointer === 'mouse' && targetId) return targetId;
  const point = svgPoint(event);
  if (point === null) return targetId;
  return hitRegion(
    drawn.map((d) => ({ id: d.id, geometry: d.geometry })),
    point,
    view.spanX * TOLERANCE_SHARE,
  );
}

/** The geometry cache for a centre, or null without one. */
function useGeometry(
  origin: { latitude: number; longitude: number } | null,
): ReturnType<typeof geometryCache> | null {
  const lat = origin?.latitude ?? null;
  const lng = origin?.longitude ?? null;
  return React.useMemo(
    () => (lat === null || lng === null ? null : geometryCache(projectionAt({ latitude: lat, longitude: lng }))),
    [lat, lng],
  );
}

/**
 * The projection, the view, the areas in draw order and the tap handlers.
 *
 * Geometry is projected once per `rings` identity and centre
 * (`geometryCache`), so a toggle — which changes `excluded`, not `rings` —
 * re-projects nothing.
 *
 * A MOUSE click on a path is that path's area: a pointer is precise. Any
 * other tap — a finger, a pen — goes to `hitRegion`: the smallest area within
 * a few pixels, so a sliver beside a big area is reachable from the map.
 */
export function useRegionMap({
  regions,
  center,
  circles = [],
  onToggle,
}: Pick<RegionMapProps, 'regions' | 'center' | 'circles' | 'onToggle'>): RegionMapModel {
  const geometryOf = useGeometry(center ?? centreOf(regions));
  const radii = circles.map((c) => c.radiusMetres);
  const outermostMetres = extent(radii)?.max ?? null;
  const view =
    geometryOf === null ? null : viewOf(outermostMetres, () => regions.map((r) => geometryOf(r.rings).bounds));
  const drawn = geometryOf && view ? drawOrder(regions, geometryOf, view) : [];
  const pointerType = React.useRef<string>('mouse');

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointerType.current = event.pointerType || 'mouse';
  };

  const onClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (!onToggle || view === null) return;
    const hit = tappedRegion(event, pointerType.current, drawn, view);
    if (hit) onToggle(hit);
  };

  return { view, drawn, radii, outermostMetres, onPointerDown, onClick };
}
