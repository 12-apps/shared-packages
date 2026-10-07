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
  // Phone-width maps keep only the fit control: pinch already zooms, and a
  // 140 px column of buttons would sit on top of the markers.
  ".routing-map{container-type:inline-size;container-name:routing-map}",
  "@container routing-map (max-width: 599px){.routing-zoom{display:none!important}}",
  ".maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{position:absolute;pointer-events:none;z-index:2}",
].join("");
