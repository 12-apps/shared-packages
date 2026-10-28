import React from 'react';

import {
  drawOrder,
  hitRegion,
  planeBounds,
  projectionAt,
  projectRings,
  viewBoxFor,
  type PlaneBox,
} from './RegionMap.helpers';
import type { RegionMapProps, RegionMapRegion } from './RegionMap.types';

/** What the drawing needs, derived once per render from the props. */
export interface RegionMapModel {
  /** The square shown, or null when there is nothing to centre on. */
  view: PlaneBox | null;
  drawn: ReturnType<typeof drawOrder>;
  /** Radii drawn, in metres; empty without circles. */
  radii: number[];
  outermostMetres: number | null;
  /** The tap handler for the drawing's `<svg>`. */
  onClick: (event: React.MouseEvent<SVGSVGElement>) => void;
}

/** A tap that misses every fill reaches an area this close: a share of the view. */
const TOLERANCE_SHARE = 1 / 45;

/** The middle of every area, for a map with no centre of its own. */
function centreOf(regions: readonly RegionMapRegion[]): { latitude: number; longitude: number } | null {
  const points = regions.flatMap((r) => r.rings.flat());
  if (points.length === 0) return null;
  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  return {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

/** The click, in the drawing's own coordinates — or null where it cannot be read. */
function svgPoint(event: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null {
  const svg = event.currentTarget;
  const matrix = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!matrix || typeof DOMPoint === 'undefined') return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

/**
 * The projection, the view, the areas in draw order and the tap handler.
 *
 * A tap on a path is that path's area (`data-region-id`): the browser has
 * already hit-tested the even-odd fill, and areas are drawn largest first, so
 * the one on top is the one the finger is on. A tap on no fill — a border
 * line, beside a sliver — goes to `hitRegion`'s nearest-within-tolerance.
 */
export function useRegionMap({
  regions,
  center,
  circles = [],
  onToggle,
}: Pick<RegionMapProps, 'regions' | 'center' | 'circles' | 'onToggle'>): RegionMapModel {
  const origin = center ?? centreOf(regions);
  const radii = circles.map((c) => c.radiusMetres);
  const outermostMetres = radii.length > 0 ? Math.max(...radii) : null;
  const projection = origin ? projectionAt(origin) : null;
  const view = projection
    ? viewBoxFor(outermostMetres, planeBounds(regions.flatMap((r) => projectRings(r.rings, projection))))
    : null;
  const drawn = projection && view ? drawOrder(regions, projection, view) : [];

  const onClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (!onToggle || view === null) return;
    const id = (event.target as Element).getAttribute('data-region-id');
    if (id) {
      onToggle(id);
      return;
    }
    const point = svgPoint(event);
    const hit =
      point === null
        ? null
        : hitRegion(
            drawn.map((d) => d.plane),
            point,
            view.spanX * TOLERANCE_SHARE,
          );
    if (hit) onToggle(hit);
  };

  return { view, drawn, radii, outermostMetres, onClick };
}
