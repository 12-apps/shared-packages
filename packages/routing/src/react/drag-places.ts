/**
 * The draggable places of one `RouteMap` (`RouteMapPlace.draggable`): what
 * each one is drawn as, its arrow keys, and MapLibre's own marker drag — all
 * reported to the host's CURRENT spec, read by key at move time, so a host
 * re-rendering with new callbacks never leaves a kept pin calling a stale one.
 */

import type { LngLat } from "../core/types";

import { draggablePlaceElement } from "./map-elements";
import { offsetMetres } from "./map-geometry";
import type { MapLike, MarkerLike } from "./maplibre-types";
import type { RouteMapDrag, RouteMapPlace, RouteMapTheme } from "./types";

/** A draggable place's current spec and position, read when it moves. */
interface DragEntry {
  spec: RouteMapDrag;
  position: LngLat;
}

/** What the overlays reconcile a draggable place as. */
export interface DragWanted {
  key: string;
  signature: string;
  position: LngLat;
  anchor: "bottom";
  role: "place";
  draggable: true;
  build: () => HTMLElement;
}

/** Arrow keys, as metres east and north per step. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** 5 m at the street (zoom 15 and in), 50 m below it. */
const defaultStep = (zoom: number): number => (zoom >= 15 ? 5 : 50);

export interface DragPlaces {
  /** Forget every spec — called before each draw lists them again. */
  reset: () => void;
  wanted: (spot: RouteMapPlace, spec: RouteMapDrag) => DragWanted;
  /** Report a new draggable marker's MapLibre drag. */
  bind: (key: string, marker: MarkerLike) => void;
  /** Hold or free every drawn pin by its spec's `disabled`. */
  sync: (markerOf: (key: string) => MarkerLike | undefined) => void;
}

/** How far in from the frame's edge an arrow key may take a pin, px (a drag's pin stays under the pointer). */
const EDGE_PX = 4;

export function dragPlaces(map: () => MapLike | null, frame: () => HTMLElement | null, theme: RouteMapTheme): DragPlaces {
  const entries = new Map<string, DragEntry>();

  /**
   * An arrow key on a focused pin: one step from where the HOST has it (a host
   * that ignores the move leaves the pin, and the next step, where they were),
   * kept inside the frame, reported as a move and a drop.
   */
  const nudge = (key: string, event: KeyboardEvent): void => {
    const entry = entries.get(key);
    const arrow = ARROWS[event.key];
    if (!entry || !arrow || entry.spec.disabled) return;
    event.preventDefault();
    const step = (entry.spec.stepMetres ?? defaultStep)(map()?.getZoom?.() ?? 13);
    const at = insideFrame(map(), frame(), offsetMetres(entry.position, arrow[0] * step, arrow[1] * step));
    entry.spec.onMove?.(at);
    entry.spec.onDrop(at);
  };

  return {
    reset: () => entries.clear(),
    wanted: (spot, spec) => {
      const key = `d:${spot.id}`;
      entries.set(key, { spec, position: spot.position });
      const onKey = (event: KeyboardEvent): void => nudge(key, event);
      return { key, signature: JSON.stringify([spot.label, spec.ariaLabel]), position: spot.position, anchor: "bottom", role: "place", draggable: true, build: () => draggablePlaceElement(spot, spec.ariaLabel, theme, onKey) };
    },
    bind: (key, marker) => {
      const report = (done: boolean): void => {
        const entry = entries.get(key);
        const at = marker.getLngLat?.();
        if (!entry || !at) return;
        const point = { lng: at.lng, lat: at.lat };
        if (done) entry.spec.onDrop(point);
        else entry.spec.onMove?.(point);
      };
      marker.on?.("drag", () => report(false));
      marker.on?.("dragend", () => report(true));
    },
    sync: (markerOf) => {
      for (const [key, entry] of entries) markerOf(key)?.setDraggable?.(!entry.spec.disabled);
    },
  };
}

/** The frame's size, px, or null when it is too small to keep a pin inside. */
function frameSize(frame: HTMLElement | null): { width: number; height: number } | null {
  const width = frame?.clientWidth ?? 0;
  const height = frame?.clientHeight ?? 0;
  return width > 2 * EDGE_PX && height > 2 * EDGE_PX ? { width, height } : null;
}

/** A point kept within the frame, `EDGE_PX` in from its edges; as it was when the map cannot say. */
function insideFrame(map: MapLike | null, frame: HTMLElement | null, at: LngLat): LngLat {
  const size = frameSize(frame);
  if (!map?.unproject || size === null) return at;
  const screen = map.project([at.lng, at.lat]);
  const x = Math.min(size.width - EDGE_PX, Math.max(EDGE_PX, screen.x));
  const y = Math.min(size.height - EDGE_PX, Math.max(EDGE_PX, screen.y));
  if (x === screen.x && y === screen.y) return at;
  const clamped = map.unproject([x, y]);
  return { lng: clamped.lng, lat: clamped.lat };
}
