/**
 * Pure helpers over what `RouteMap` draws: the box that holds it all, the
 * screen-space grouping of overlapping markers, and the two line layers.
 */

import { isValidPoint } from "../core/geo";
import type { LngLat, Position } from "../core/types";

import type { MapLike } from "./maplibre-types";
import type { RouteMapCircle, RouteMapDot, RouteMapMarker, RouteMapProps, RouteMapTheme } from "./types";

/** Below this many pixels apart, two markers are one tap target. */
const GROUP_RADIUS_PX = 32;

export const PLANNED_LAYER = "routing-planned";
export const TRAVELLED_LAYER = "routing-travelled";
export const CIRCLES_SOURCE = "routing-circles";
export const DOTS_SOURCE = "routing-dots";

/** Metres in one degree of latitude (and of longitude at the equator). */
const METRES_PER_DEGREE = 111_320;
/** Segments a circle is drawn with: smooth at any zoom a ring is read at. */
const CIRCLE_SEGMENTS = 96;

export function pointsOf(props: RouteMapProps): LngLat[] {
  const points: LngLat[] = [
    ...(props.markers ?? []).map((marker) => marker.position),
    ...(props.stops ?? []).map((stop) => stop.position),
    ...(props.places ?? []).map((spot) => spot.position),
    ...(props.planned ?? []).map(([lng, lat]) => ({ lng, lat })),
    ...(props.circles ?? []).flatMap(circleBox),
  ];
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

/** Several strokes as one MultiLineString; a part under two points is dropped. */
function partsFeature(parts: readonly (readonly Position[])[]) {
  const coordinates = parts.filter((part) => part.length > 1).map((part) => part.map((p) => [p[0], p[1]]));
  return { type: "Feature" as const, properties: {}, geometry: { type: "MultiLineString" as const, coordinates } };
}

/** The travelled line: its parts when given, else the one line. */
export function setTravelled(
  map: MapLike,
  id: string,
  line: readonly Position[] | undefined,
  parts: readonly (readonly Position[])[] | undefined,
): void {
  if (parts) map.getSource(id)?.setData(partsFeature(parts));
  else setLine(map, id, line);
}

/** A point `dx` metres east and `dy` metres north of `from` (flat-earth, exact enough within a city). */
export function offsetMetres(from: LngLat, dx: number, dy: number): LngLat {
  const lat = from.lat + dy / METRES_PER_DEGREE;
  const lng = from.lng + dx / (METRES_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180));
  return { lng, lat };
}

/** The two corners of the box a circle fills, so a fit shows it whole. */
function circleBox(circle: RouteMapCircle): LngLat[] {
  if (!isValidPoint(circle.center) || !(circle.radiusMetres > 0)) return [];
  const r = circle.radiusMetres;
  return [offsetMetres(circle.center, -r, -r), offsetMetres(circle.center, r, r)];
}

/** The ring of a circle as `[lng, lat]` positions, closed. */
export function circleRing(circle: RouteMapCircle): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    const at = offsetMetres(circle.center, circle.radiusMetres * Math.cos(angle), circle.radiusMetres * Math.sin(angle));
    ring.push([at.lng, at.lat]);
  }
  return ring;
}

/** Every valid circle as a polygon carrying its colour and whether it is dashed. */
export function circlesFeature(circles: readonly RouteMapCircle[] | undefined, theme: RouteMapTheme) {
  const features = (circles ?? [])
    .filter((circle) => isValidPoint(circle.center) && circle.radiusMetres > 0)
    .map((circle) => ({
      type: "Feature" as const,
      properties: { id: circle.id, dashed: !!circle.dashed, color: circle.color ?? (circle.dashed ? theme.ink : theme.travelled) },
      geometry: { type: "Polygon" as const, coordinates: [circleRing(circle)] },
    }));
  return { type: "FeatureCollection" as const, features };
}

/** Every valid dot as a point carrying whether it is filled. */
export function dotsFeature(dots: readonly RouteMapDot[] | undefined) {
  const features = (dots ?? [])
    .filter((dot) => isValidPoint(dot.position))
    .map((dot) => ({
      type: "Feature" as const,
      properties: { id: dot.id, filled: dot.filled },
      geometry: { type: "Point" as const, coordinates: [dot.position.lng, dot.position.lat] },
    }));
  return { type: "FeatureCollection" as const, features };
}

/**
 * The circle and dot layers. Added the first time a host draws one, so after
 * the route lines: over their strokes, and under every pin (pins are DOM
 * markers, above the canvas).
 */
export function addShapes(map: MapLike, theme: RouteMapTheme): void {
  map.addSource(CIRCLES_SOURCE, { type: "geojson", data: circlesFeature([], theme) });
  map.addSource(DOTS_SOURCE, { type: "geojson", data: dotsFeature([]) });
  const solid = ["!", ["get", "dashed"]];
  map.addLayer({ id: `${CIRCLES_SOURCE}-fill`, type: "fill", source: CIRCLES_SOURCE, filter: solid, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.07 } });
  map.addLayer({ id: `${CIRCLES_SOURCE}-line`, type: "line", source: CIRCLES_SOURCE, filter: solid, paint: { "line-color": ["get", "color"], "line-width": 2.5 } });
  map.addLayer({ id: `${CIRCLES_SOURCE}-dashed`, type: "line", source: CIRCLES_SOURCE, filter: ["get", "dashed"], paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-dasharray": [3, 2.5] } });
  map.addLayer({
    id: DOTS_SOURCE,
    type: "circle",
    source: DOTS_SOURCE,
    paint: { "circle-radius": 5, "circle-color": ["case", ["get", "filled"], theme.ink, theme.paper], "circle-stroke-color": theme.ink, "circle-stroke-width": 2 },
  });
}
