/**
 * Every word the map draws. Required host config — there are no defaults in
 * the component; the named packs (`./pt-BR`, `./en-US`, `./locales`) are what a
 * host passes when it has no reason to say anything else.
 */

export interface RouteMapCopy {
  /** Zoom-in control's accessible name. */
  zoomIn: string;
  /** Zoom-out control's accessible name. */
  zoomOut: string;
  /** Fit-everything control's accessible name. */
  fitAll: string;
  /** The map area's own accessible name. */
  mapLabel: string;
  /** Shown in place of the map when it cannot render (no WebGL, style failed). */
  mapError: string;
  /** The retry button under `mapError`. */
  retry: string;
  /** A group of overlapping markers, by how many it holds. */
  group: (count: number) => string;
  /** The basemap's required attribution line. */
  attribution: string;
}
