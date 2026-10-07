/**
 * The few rules MapLibre's own stylesheet supplies that the map cannot work
 * without (canvas and marker positioning). Injected once at mount rather than
 * imported, so the package keeps `sideEffects: false` and a host needs no CSS
 * loader for it.
 */

export const MAP_CSS_ID = "routing-map-css";

export const MAP_CSS = [
  ".maplibregl-map{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}",
  ".maplibregl-canvas{position:absolute;left:0;top:0}",
  ".maplibregl-canvas-container.maplibregl-interactive{cursor:grab}",
  ".maplibregl-marker{position:absolute;top:0;left:0;will-change:transform}",
  ".maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{position:absolute;pointer-events:none;z-index:2}",
].join("");
