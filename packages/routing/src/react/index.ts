/**
 * `@12-apps/routing/react` — the web host's surface:
 * `createWebRouting(config) → { RouteMap }`. Build once per config (the wiring
 * binder does); `RouteMap` is a component TYPE the host places wherever a
 * route belongs.
 */

import { buildRouteMap } from "./route-map";
import type { RouteMapConfig, RouteMapProps } from "./types";
import type { JSX } from "react";

export interface RoutingSurface {
  RouteMap: (props: RouteMapProps) => JSX.Element;
}

export function createWebRouting(config: RouteMapConfig): RoutingSurface {
  if (!config?.copy || !config.theme) throw new TypeError("createWebRouting: `copy` and `theme` are required");
  return { RouteMap: buildRouteMap(config) };
}

export { DEFAULT_STYLE_URL } from "./route-map";
export { boundsOf, groupMarkers } from "./map-geometry";
export type { RouteMapConfig, RouteMapMarker, RouteMapPlace, RouteMapProps, RouteMapStop, RouteMapTheme } from "./types";
export type { RouteMapCopy } from "./copy";
export type { MapLibreLike, MapLike, MarkerLike } from "./maplibre-types";
export { PT_BR_ROUTE_MAP_COPY } from "./pt-BR";
export { EN_US_ROUTE_MAP_COPY } from "./en-US";
export { ROUTE_MAP_COPY } from "./locales";
