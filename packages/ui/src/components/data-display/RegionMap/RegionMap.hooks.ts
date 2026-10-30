import React from 'react';

import {
  drawOrder,
  extent,
  geometryCache,
  hitRegion,
  projectionAt,
  type DrawnRegion,
  type PlaneBox,
  type Projection,
} from './RegionMap.helpers';
import type { RegionMapProps } from './RegionMap.types';
import { centreOf, reachBox, viewWithin } from './RegionMap.view';

/** What the drawing needs, derived from the props. */
export interface RegionMapModel {
  /** The square shown, or null when there is nothing to centre on. */
  view: PlaneBox | null;
  /** The projection drawn with, or null when there is nothing to centre on. */
  projection: Projection | null;
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

/** The click, in the drawing's own coordinates — or null where it cannot be read. */
function svgPoint(event: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null {
  const svg = event.currentTarget;
  const matrix = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!matrix || typeof DOMPoint === 'undefined') return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
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

/** The projection and geometry cache for a centre, or nulls without one. */
function useGeometry(origin: { latitude: number; longitude: number } | null): {
  projection: Projection | null;
  geometryOf: ReturnType<typeof geometryCache> | null;
} {
  const lat = origin?.latitude ?? null;
  const lng = origin?.longitude ?? null;
  return React.useMemo(() => {
    if (lat === null || lng === null) return { projection: null, geometryOf: null };
    const projection = projectionAt({ latitude: lat, longitude: lng });
    return { projection, geometryOf: geometryCache(projection) };
  }, [lat, lng]);
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
  reach,
  onToggle,
}: Pick<RegionMapProps, 'regions' | 'center' | 'circles' | 'reach' | 'onToggle'>): RegionMapModel {
  const { projection, geometryOf } = useGeometry(center ?? centreOf(regions));
  const radii = circles.map((c) => c.radiusMetres);
  const outermostMetres = extent(radii)?.max ?? null;
  const view =
    projection === null || geometryOf === null
      ? null
      : viewWithin(outermostMetres, reach === undefined ? null : reachBox(reach, projection), () =>
          regions.map((r) => geometryOf(r.rings).bounds),
        );
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

  return { view, projection, drawn, radii, outermostMetres, onPointerDown, onClick };
}
