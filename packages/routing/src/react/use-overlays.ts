/**
 * Everything `RouteMap` draws on top of the basemap, kept in step with the
 * props: the two lines, the markers (regrouped after every pan or zoom), the
 * stops and places, and the viewport fit — once when ready, then only when
 * `fitKey` changes or the viewer asks.
 *
 * ## Reconciled by key, never rebuilt
 *
 * Every drawn element has a key (`m:<id>`, `g:<ids>`, `s:<id>`, `p:<id>`)
 * and a signature of what it shows. A redraw moves elements whose signature is
 * unchanged, replaces the ones that changed and removes the ones that left —
 * so a refresh every few seconds, a pan, or the host re-rendering with a new
 * array never drops the keyboard focus a viewer put on a marker. Click
 * handlers read the host's CURRENT callback by key, so a kept element never
 * calls a stale one.
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

interface Drawn {
  marker: MarkerLike;
  element: HTMLElement;
  signature: string;
}

interface Wanted {
  key: string;
  signature: string;
  position: LngLat;
  anchor: "bottom" | "center";
  build: () => HTMLElement;
}

export function useOverlays(
  handle: Pick<MapHandle, "mapRef" | "libRef">,
  propsRef: MutableRefObject<RouteMapProps>,
  copy: RouteMapCopy,
  theme: RouteMapTheme,
): Overlays {
  const drawn = useRef(new Map<string, Drawn>());
  /** The current action per key, read at click time. */
  const actions = useRef(new Map<string, () => void>());

  const clear = (): void => {
    for (const item of drawn.current.values()) item.marker.remove();
    drawn.current.clear();
  };

  const onGroup = (group: readonly RouteMapMarker[]): void => {
    const handler = propsRef.current.onGroupSelect;
    if (handler) return handler(group.map((marker) => marker.id));
    const bounds = boundsOf(group.map((marker) => marker.position));
    if (bounds) handle.mapRef.current?.fitBounds(bounds, { padding: 64, maxZoom: 19, duration: 300 });
  };

  const wanted = (props: RouteMapProps): Wanted[] => {
    const map = handle.mapRef.current;
    if (!map) return [];
    actions.current.clear();
    const out: Wanted[] = [];
    for (const spot of (props.places ?? []).filter((item) => isValidPoint(item.position))) {
      out.push({ key: `p:${spot.id}`, signature: JSON.stringify([spot.label, spot.icon]), position: spot.position, anchor: "bottom", build: () => placeElement(spot, theme) });
    }
    for (const stop of (props.stops ?? []).filter((item) => isValidPoint(item.position))) {
      out.push({ key: `s:${stop.id}`, signature: JSON.stringify([stop.mark, stop.title, stop.variant]), position: stop.position, anchor: "center", build: () => stopElement(stop, theme) });
    }
    const valid = (props.markers ?? []).filter((marker) => isValidPoint(marker.position));
    for (const group of groupMarkers(valid, map)) out.push(group.length === 1 ? markerWanted(group[0]!) : groupWanted(group));
    return out;
  };

  const markerWanted = (marker: RouteMapMarker): Wanted => {
    const key = `m:${marker.id}`;
    if (marker.onSelect) actions.current.set(key, marker.onSelect);
    const act = marker.onSelect ? () => actions.current.get(key)?.() : null;
    const signature = JSON.stringify([marker.text, marker.ariaLabel, marker.color, !!marker.emphasized, !!marker.faded, marker.icon, !!marker.onSelect]);
    return { key, signature, position: marker.position, anchor: "bottom", build: () => markerElement(marker, theme, act) };
  };

  const groupWanted = (group: RouteMapMarker[]): Wanted => {
    const key = `g:${group.map((marker) => marker.id).join(",")}`;
    actions.current.set(key, () => onGroup(group));
    return { key, signature: String(group.length), position: group[0]!.position, anchor: "bottom", build: () => groupElement(group.length, copy, theme, () => actions.current.get(key)?.()) };
  };

  const draw = (): void => {
    const lib = handle.libRef.current;
    const map = handle.mapRef.current;
    if (lib && map) reconcile(drawn.current, wanted(propsRef.current), (element, anchor, at) => new lib.Marker({ element, anchor }).setLngLat(at).addTo(map));
  };

  const fitAll = (): void => {
    // The control column sits on the right edge: keep fitted content clear of
    // it, or the farthest stop lands under the fit button.
    const controls = propsRef.current.controls;
    const right = (controls?.zoom ?? true) || (controls?.fit ?? true) ? 76 : 40;
    const bounds = boundsOf(pointsOf(propsRef.current));
    if (bounds) handle.mapRef.current?.fitBounds(bounds, { padding: { top: 40, bottom: 48, left: 40, right }, maxZoom: 16, duration: 0 });
  };

  return { draw, clear, fitAll };
}

type Place = (element: HTMLElement, anchor: Wanted["anchor"], at: [number, number]) => MarkerLike;

/** Remove what left, move what is unchanged, replace what changed — keeping focus. */
function reconcile(drawn: Map<string, Drawn>, next: readonly Wanted[], place: Place): void {
  const keep = new Set(next.map((item) => item.key));
  for (const [key, item] of drawn) {
    if (keep.has(key)) continue;
    item.marker.remove();
    drawn.delete(key);
  }
  for (const item of next) {
    const at: [number, number] = [item.position.lng, item.position.lat];
    const current = drawn.get(item.key);
    if (current?.signature === item.signature) {
      current.marker.setLngLat(at);
      continue;
    }
    const hadFocus = !!current && current.element.contains(document.activeElement);
    current?.marker.remove();
    const element = item.build();
    drawn.set(item.key, { marker: place(element, item.anchor, at), element, signature: item.signature });
    if (hadFocus) element.focus();
  }
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
