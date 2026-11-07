/**
 * The scale bar a host asks for with `RouteMapProps.scaleBar`: bottom-left,
 * the longest nice distance within a quarter of the map's width at the
 * current zoom and latitude (Web Mercator, 512-px tiles as MapLibre draws).
 */

import type { CSSProperties, JSX } from "react";

import type { MapLike } from "./maplibre-types";
import type { RouteMapTheme } from "./types";

/** The equator's length, metres. */
const EARTH_CIRCUMFERENCE = 40_075_016.686;
/** MapLibre's tile size at zoom 0, px. */
const TILE_PX = 512;
/** Nice lengths a bar may take, metres. */
const STEPS = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];

export interface ScaleReading {
  metres: number;
  px: number;
}

/** Metres one screen pixel covers at `zoom` and `latitude`. */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

/** The bar for a map `widthPx` wide: the longest step within a quarter of it (the shortest when none fits). */
export function scaleReading(zoom: number, latitude: number, widthPx: number): ScaleReading {
  const perPx = metresPerPixel(zoom, latitude);
  const quarter = (widthPx / 4) * perPx;
  const metres = STEPS.filter((step) => step <= quarter).at(-1) ?? STEPS[0]!;
  return { metres, px: Math.round(metres / perPx) };
}

/** The reading for a live map, or null when it cannot say its zoom or centre. */
export function readScale(map: MapLike | null, widthPx: number): ScaleReading | null {
  const zoom = map?.getZoom?.();
  const centre = map?.getCenter?.();
  if (zoom === undefined || centre === undefined || widthPx <= 0) return null;
  return scaleReading(zoom, centre.lat, widthPx);
}

export function ScaleBar({ reading, label, theme }: { reading: ScaleReading; label: (metres: number) => string; theme: RouteMapTheme }): JSX.Element {
  const box: CSSProperties = { position: "absolute", left: 10, bottom: 8, zIndex: 2, pointerEvents: "none", color: theme.ink, fontSize: 11 };
  return (
    <div data-routing-scale="" aria-hidden="true" style={box}>
      <span style={{ display: "block", background: theme.paper, padding: "0 3px", borderRadius: 3, width: "fit-content" }}>{label(reading.metres)}</span>
      <span style={{ display: "block", width: reading.px, height: 4, borderStyle: "solid", borderColor: theme.ink, borderWidth: "0 1.5px 1.5px" }} />
    </div>
  );
}
