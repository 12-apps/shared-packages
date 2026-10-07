/**
 * Pure helpers over what `RouteMap` draws: the box that holds it all, the
 * screen-space grouping of overlapping markers, and the two line layers.
 */

import { isValidPoint } from "../core/geo";
import type { LngLat, Position } from "../core/types";

import type { MapLike } from "./maplibre-types";
import type { RouteMapMarker, RouteMapProps, RouteMapTheme } from "./types";

/** Below this many pixels apart, two markers are one tap target. */
const GROUP_RADIUS_PX = 32;

export const PLANNED_LAYER = "routing-planned";
export const TRAVELLED_LAYER = "routing-travelled";

export function pointsOf(props: RouteMapProps): LngLat[] {
  const points: LngLat[] = [];
  for (const marker of props.markers ?? []) points.push(marker.position);
  for (const stop of props.stops ?? []) points.push(stop.position);
  for (const spot of props.places ?? []) points.push(spot.position);
  for (const [lng, lat] of props.planned ?? []) points.push({ lng, lat });
  return points.filter((point) => isValidPoint(point));
}

export function centreOf(props: RouteMapProps): [number, number] {
  const first = pointsOf(props)[0];
  return first ? [first.lng, first.lat] : [0, 0];
}

/** The box around every valid point; a lone point still gets a street-sized box. */
export function boundsOf(points: readonly LngLat[]): [[number, number], [number, number]] | null {
  const valid = points.filter((point) => isValidPoint(point));
  if (valid.length === 0) return null;
  const lngs = valid.map((point) => point.lng);
  const lats = valid.map((point) => point.lat);
  let [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  let [south, north] = [Math.min(...lats), Math.max(...lats)];
  const pad = 0.0025;
  if (east - west < pad) [west, east] = [west - pad, east + pad];
  if (north - south < pad) [south, north] = [south - pad, north + pad];
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Greedy screen-space grouping: each marker joins the first group whose anchor
 * is within `GROUP_RADIUS_PX`. An emphasised marker always stands alone.
 */
export function groupMarkers(markers: readonly RouteMapMarker[], map: Pick<MapLike, "project">): RouteMapMarker[][] {
  const groups: { anchor: { x: number; y: number }; members: RouteMapMarker[] }[] = [];
  const alone: RouteMapMarker[][] = [];
  for (const marker of markers) {
    if (marker.emphasized) {
      alone.push([marker]);
      continue;
    }
    const at = map.project([marker.position.lng, marker.position.lat]);
    const hit = groups.find((group) => Math.hypot(group.anchor.x - at.x, group.anchor.y - at.y) < GROUP_RADIUS_PX);
    if (hit) hit.members.push(marker);
    else groups.push({ anchor: at, members: [marker] });
  }
  return [...groups.map((group) => group.members), ...alone];
}

function lineFeature(positions: readonly Position[]) {
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: positions.map((p) => [p[0], p[1]]) } };
}

export function addLines(map: MapLike, theme: RouteMapTheme): void {
  for (const id of [PLANNED_LAYER, TRAVELLED_LAYER]) map.addSource(id, { type: "geojson", data: lineFeature([]) });
  const layout = { "line-cap": "round", "line-join": "round" };
  map.addLayer({ id: PLANNED_LAYER, type: "line", source: PLANNED_LAYER, layout, paint: { "line-color": theme.planned, "line-width": 4, "line-dasharray": [2, 1.6] } });
  map.addLayer({ id: TRAVELLED_LAYER, type: "line", source: TRAVELLED_LAYER, layout, paint: { "line-color": theme.travelled, "line-width": 5 } });
}

export function setLine(map: MapLike, id: string, positions: readonly Position[] | undefined): void {
  map.getSource(id)?.setData(lineFeature(positions ?? []));
}
