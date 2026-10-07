/**
 * The MapLibre instance behind one `RouteMap`: load the library lazily, build
 * the map with both line layers, report `loading | ready | error`, and tear it
 * down on unmount or before a retry. A failure before the first `load` (no
 * WebGL, a style that does not arrive) is `error`; a tile failing later is not.
 * Readiness is the style's, not the tiles' (`style.load`).
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { MAP_CSS, MAP_CSS_ID } from "./map-css";
import { addLines, centreOf } from "./map-geometry";
import type { MapLibreLike, MapLike } from "./maplibre-types";
import type { RouteMapProps, RouteMapTheme } from "./types";

export type MapStatus = "loading" | "ready" | "error";

export interface MapHandle {
  mapRef: MutableRefObject<MapLike | null>;
  libRef: MutableRefObject<MapLibreLike | null>;
  status: MapStatus;
  retry: () => void;
}

interface MapSetup {
  load: () => Promise<MapLibreLike>;
  styleUrl: string;
  theme: RouteMapTheme;
  container: MutableRefObject<HTMLDivElement | null>;
  propsRef: MutableRefObject<RouteMapProps>;
  /** Called after each pan or zoom, to regroup markers. */
  onMoveEnd: () => void;
  /** Called before the map goes away, to drop markers. */
  onDispose: () => void;
}

function injectCss(): void {
  if (typeof document === "undefined" || document.getElementById(MAP_CSS_ID)) return;
  const style = document.createElement("style");
  style.id = MAP_CSS_ID;
  style.textContent = MAP_CSS;
  document.head.appendChild(style);
}

export function useMapInstance(setup: MapSetup): MapHandle {
  const mapRef = useRef<MapLike | null>(null);
  const libRef = useRef<MapLibreLike | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const [status, setStatus] = useState<MapStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    injectCss();
    let disposed = false;
    setStatus("loading");
    const current = setupRef.current;
    void current
      .load()
      .then((lib) => {
        if (disposed || !current.container.current) return;
        libRef.current = lib;
        const map = new lib.Map({ container: current.container.current, style: current.styleUrl, attributionControl: false, center: centreOf(current.propsRef.current), zoom: 13 });
        mapRef.current = map;
        let loaded = false;
        map.on("error", () => {
          if (!loaded && !disposed) setStatus("error");
        });
        // Ready as soon as the STYLE is in: sources, layers and markers need
        // nothing more. `load` waits for every first tile too, which over a
        // slow link can be many seconds of an empty map; it stays as a backstop.
        const onReady = (): void => {
          if (disposed || loaded) return;
          loaded = true;
          addLines(map, current.theme);
          setStatus("ready");
        };
        map.on("style.load", onReady);
        map.on("load", onReady);
        map.on("moveend", () => setupRef.current.onMoveEnd());
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });
    return () => {
      disposed = true;
      setupRef.current.onDispose();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  return { mapRef, libRef, status, retry: () => setAttempt((n) => n + 1) };
}
