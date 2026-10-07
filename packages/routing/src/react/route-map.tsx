/**
 * `RouteMap` — a geographic map that draws what the host hands it: markers
 * (people, vehicles), places (a shop), numbered stops, a planned line (dashed)
 * and a travelled line (solid). It fetches nothing and decides nothing: every
 * point, word and colour is a prop or config, so the same component serves a
 * fleet overview and a single order's card.
 *
 * - **Real projection.** MapLibre GL over a vector style (OpenFreeMap by
 *   default), loaded lazily the first time a map mounts.
 * - **The viewport is the viewer's.** It fits once, and again only when
 *   `fitKey` changes or the fit control is pressed.
 * - **Overlapping markers stay reachable** as one group button.
 * - **Failure is visible, not blank**: the host's error copy and a retry.
 */

import { useRef, type CSSProperties, type JSX } from "react";

import type { RouteMapCopy } from "./copy";
import type { MapLibreLike } from "./maplibre-types";
import type { RouteMapConfig, RouteMapProps, RouteMapTheme } from "./types";
import { useMapInstance } from "./use-map";
import { useOverlays, useOverlaySync } from "./use-overlays";

export const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const defaultLoader = async (): Promise<MapLibreLike> => {
  const lib = (await import("maplibre-gl")) as unknown as { default?: MapLibreLike } & MapLibreLike;
  return lib.default ?? lib;
};

export function buildRouteMap(config: RouteMapConfig): (props: RouteMapProps) => JSX.Element {
  const { copy, theme } = config;
  const baseLoad = config.loadMapLibre ?? defaultLoader;
  const load = async (): Promise<MapLibreLike> => {
    const lib = await baseLoad();
    if (config.workerUrl) lib.setWorkerUrl?.(config.workerUrl);
    return lib;
  };
  const styleUrl = config.styleUrl ?? DEFAULT_STYLE_URL;

  return function RouteMap(props: RouteMapProps): JSX.Element {
    const container = useRef<HTMLDivElement | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const overlaysRef = useRef<ReturnType<typeof useOverlays> | null>(null);
    const handle = useMapInstance({
      load,
      styleUrl,
      theme,
      container,
      propsRef,
      onMoveEnd: () => overlaysRef.current?.draw(),
      onDispose: () => overlaysRef.current?.clear(),
    });
    const overlays = useOverlays(handle, propsRef, copy, theme);
    overlaysRef.current = overlays;
    useOverlaySync(handle.status === "ready", handle, props, overlays, theme);

    const height = typeof props.height === "number" ? `${props.height}px` : props.height;
    return (
      <div data-testid={props.testId} role="region" aria-label={copy.mapLabel} style={{ position: "relative", height, width: "100%", overflow: "hidden", borderRadius: "inherit" }}>
        <div ref={container} style={{ position: "absolute", inset: 0 }} />
        {handle.status === "error" ? (
          <MapError copy={copy} theme={theme} onRetry={handle.retry} />
        ) : (
          <MapControls
            copy={copy}
            theme={theme}
            zoom={props.controls?.zoom ?? true}
            fit={props.controls?.fit ?? true}
            onZoomIn={() => handle.mapRef.current?.zoomIn()}
            onZoomOut={() => handle.mapRef.current?.zoomOut()}
            onFit={() => {
              overlays.fitAll();
              propsRef.current.onFitAll?.();
            }}
          />
        )}
        {props.overlay ? <div style={{ position: "absolute", left: 12, right: 12, bottom: 28, zIndex: 2 }}>{props.overlay}</div> : null}
        <small style={{ position: "absolute", right: 6, bottom: 4, fontSize: 10, color: theme.ink, background: theme.paper, padding: "0 4px", borderRadius: 4, zIndex: 2 }}>{copy.attribution}</small>
      </div>
    );
  };
}

interface ControlsProps {
  copy: RouteMapCopy;
  theme: RouteMapTheme;
  zoom: boolean;
  fit: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

function MapControls({ copy, theme, zoom, fit, onZoomIn, onZoomOut, onFit }: ControlsProps): JSX.Element | null {
  if (!zoom && !fit) return null;
  return (
    <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 2 }}>
      {zoom ? (
        <>
          <button type="button" aria-label={copy.zoomIn} onClick={onZoomIn} style={controlStyle(theme)}>
            +
          </button>
          <button type="button" aria-label={copy.zoomOut} onClick={onZoomOut} style={controlStyle(theme)}>
            −
          </button>
        </>
      ) : null}
      {fit ? (
        <button type="button" aria-label={copy.fitAll} onClick={onFit} style={controlStyle(theme)}>
          <FitIcon />
        </button>
      ) : null}
    </div>
  );
}

function MapError({ copy, theme, onRetry }: { copy: RouteMapCopy; theme: RouteMapTheme; onRetry: () => void }): JSX.Element {
  const style: CSSProperties = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: theme.paper, color: theme.ink, textAlign: "center", padding: 16 };
  return (
    <div role="alert" style={style}>
      <span>{copy.mapError}</span>
      <button type="button" onClick={onRetry} style={{ ...controlStyle(theme), width: "auto", padding: "0 14px", fontSize: 14 }}>
        {copy.retry}
      </button>
    </div>
  );
}

function FitIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function controlStyle(theme: RouteMapTheme): CSSProperties {
  return { minWidth: 44, width: 44, height: 44, padding: 0, borderRadius: 10, border: `1px solid ${theme.controlBorder}`, background: theme.control, color: theme.ink, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
}
