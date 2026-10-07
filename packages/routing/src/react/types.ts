import type { ReactNode } from "react";

import type { LngLat, Position } from "../core/types";

import type { RouteMapCopy } from "./copy";
import type { MapLibreLike } from "./maplibre-types";

export interface RouteMapMarker {
  id: string;
  position: LngLat;
  /** What the marker reads — initials, or a name when emphasised. */
  text: string;
  ariaLabel: string;
  color: string;
  /** The selected marker: larger, on top, never grouped. */
  emphasized?: boolean;
  /** An old position: dashed outline, translucent. */
  faded?: boolean;
  /** A glyph before the text: a motorbike for a courier. */
  icon?: "motorbike";
  onSelect?: () => void;
}

export interface RouteMapStop {
  id: string;
  position: LngLat;
  /** "✓", "2", … */
  mark: string;
  /** Accessible title, e.g. "Parada 2 — Av. Vilarinho, 1731". */
  title: string;
  variant: "done" | "next" | "pending";
}

export interface RouteMapPlace {
  id: string;
  position: LngLat;
  label: string;
  /** A glyph before the label: a shopfront for a store. */
  icon?: "store";
}

/** Colours, from the host's theme — the component never picks one itself. */
export interface RouteMapTheme {
  planned: string;
  travelled: string;
  done: string;
  next: string;
  pending: string;
  ink: string;
  paper: string;
  place: string;
  control: string;
  controlBorder: string;
}

export interface RouteMapProps {
  markers?: readonly RouteMapMarker[];
  stops?: readonly RouteMapStop[];
  places?: readonly RouteMapPlace[];
  /** The dashed line, `[lng, lat][]`. */
  planned?: readonly Position[];
  /** The solid line, `[lng, lat][]`. */
  travelled?: readonly Position[];
  /** Overrides `theme.travelled` (a status colour). */
  travelledColor?: string;
  /** Change it to refit the viewport to everything drawn. */
  fitKey?: string;
  /** CSS height of the map area. */
  height: number | string;
  controls?: { zoom?: boolean; fit?: boolean };
  /** Called when the viewer presses the fit control (after it fits). */
  onFitAll?: () => void;
  /** Called with the ids of a pressed group of overlapping markers. */
  onGroupSelect?: (markerIds: string[]) => void;
  /** Rendered over the map (a legend), bottom edge. */
  overlay?: ReactNode;
  testId?: string;
}

export interface RouteMapConfig {
  copy: RouteMapCopy;
  theme: RouteMapTheme;
  /** A MapLibre style URL. Defaults to OpenFreeMap "liberty". */
  styleUrl?: string;
  /**
   * Where MapLibre's worker file is served from. MapLibre 6 ships the worker
   * as its own module (`maplibre-gl/dist/maplibre-gl-worker.mjs`) and cannot
   * guess its bundled URL; a Vite host passes
   * `import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"`.
   */
  workerUrl?: string;
  /** How to load MapLibre — swapped in tests, or for a host that preloads it. */
  loadMapLibre?: () => Promise<MapLibreLike>;
}
