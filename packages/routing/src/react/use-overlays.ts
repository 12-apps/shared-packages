/**
 * Everything `RouteMap` draws on top of the basemap, kept in step with the
 * props: the two lines, the markers (regrouped after every pan or zoom), the
 * stops and places, and the viewport fit — once when ready, then only when
 * `fitKey` changes or the viewer asks.
 */

import { useEffect, useRef, type MutableRefObject } from "react";

import { isValidPoint } from "../core/geo";
import type { LngLat } from "../core/types";

import type { RouteMapCopy } from "./copy";
import { groupElement, markerElement, placeElement, stopElement } from "./map-elements";
import { boundsOf, groupMarkers, PLANNED_LAYER, pointsOf, setLine, TRAVELLED_LAYER } from "./map-geometry";
import type { MarkerLike } from "./maplibre-types";
import type { MapHandle } from "./use-map";
import type { RouteMapMarker, RouteMapProps, RouteMapTheme } from "./types";

interface Overlays {
  draw: () => void;
  clear: () => void;
  fitAll: () => void;
}

export function useOverlays(
  handle: Pick<MapHandle, "mapRef" | "libRef">,
  propsRef: MutableRefObject<RouteMapProps>,
  copy: RouteMapCopy,
  theme: RouteMapTheme,
): Overlays {
  const markers = useRef<MarkerLike[]>([]);

  const clear = (): void => {
    for (const marker of markers.current) marker.remove();
    markers.current = [];
  };

  const put = (element: HTMLElement, position: LngLat, anchor: "bottom" | "center"): void => {
    const { libRef, mapRef } = handle;
    if (!libRef.current || !mapRef.current) return;
    markers.current.push(new libRef.current.Marker({ element, anchor }).setLngLat([position.lng, position.lat]).addTo(mapRef.current));
  };

  const onGroup = (group: readonly RouteMapMarker[]): void => {
    const handler = propsRef.current.onGroupSelect;
    if (handler) return handler(group.map((marker) => marker.id));
    const bounds = boundsOf(group.map((marker) => marker.position));
    if (bounds) handle.mapRef.current?.fitBounds(bounds, { padding: 64, maxZoom: 19, duration: 300 });
  };

  const drawMarkers = (props: RouteMapProps): void => {
    const map = handle.mapRef.current;
    if (!map) return;
    const valid = (props.markers ?? []).filter((marker) => isValidPoint(marker.position));
    for (const group of groupMarkers(valid, map)) {
      const element = group.length === 1 ? markerElement(group[0]!, theme) : groupElement(group.length, copy, theme, () => onGroup(group));
      put(element, group[0]!.position, "bottom");
    }
  };

  const draw = (): void => {
    if (!handle.mapRef.current) return;
    clear();
    const props = propsRef.current;
    for (const spot of (props.places ?? []).filter((item) => isValidPoint(item.position))) put(placeElement(spot, theme), spot.position, "bottom");
    for (const stop of (props.stops ?? []).filter((item) => isValidPoint(item.position))) put(stopElement(stop, theme), stop.position, "center");
    drawMarkers(props);
  };

  const fitAll = (): void => {
    const bounds = boundsOf(pointsOf(propsRef.current));
    // The control column sits on the right edge: keep fitted content clear of
    // it, or the farthest stop lands under the fit button.
    const controls = propsRef.current.controls;
    const right = (controls?.zoom ?? true) || (controls?.fit ?? true) ? 76 : 40;
    if (bounds) handle.mapRef.current?.fitBounds(bounds, { padding: { top: 40, bottom: 48, left: 40, right }, maxZoom: 16, duration: 0 });
  };

  return { draw, clear, fitAll };
}

/** Keep lines, markers and the fit in step with the props once the map is ready. */
export function useOverlaySync(ready: boolean, handle: Pick<MapHandle, "mapRef">, props: RouteMapProps, overlays: Overlays, theme: RouteMapTheme): void {
  useEffect(() => {
    const map = handle.mapRef.current;
    if (!ready || !map) return;
    setLine(map, PLANNED_LAYER, props.planned);
    setLine(map, TRAVELLED_LAYER, props.travelled);
    map.setPaintProperty(TRAVELLED_LAYER, "line-color", props.travelledColor ?? theme.travelled);
  }, [ready, props.planned, props.travelled, props.travelledColor]);

  useEffect(() => {
    if (ready) overlays.draw();
  }, [ready, props.markers, props.stops, props.places]);

  useEffect(() => {
    if (ready) overlays.fitAll();
  }, [ready, props.fitKey]);
}
