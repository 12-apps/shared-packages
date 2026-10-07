/**
 * The slice of MapLibre GL this package calls — declared here so the
 * component compiles and tests run without the library's WebGL runtime, and
 * so a test can hand in a fake. `maplibre-gl` satisfies it structurally.
 */

export interface MapLike {
  on(event: "load" | "style.load" | "error" | "moveend", listener: () => void): unknown;
  remove(): void;
  addSource(id: string, source: { type: "geojson"; data: unknown }): unknown;
  getSource(id: string): { setData(data: unknown): unknown } | undefined;
  addLayer(layer: Record<string, unknown>): unknown;
  setPaintProperty(layer: string, property: string, value: unknown): unknown;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): unknown;
  zoomIn(): unknown;
  zoomOut(): unknown;
  project(lngLat: [number, number]): { x: number; y: number };
}

export interface MarkerLike {
  setLngLat(lngLat: [number, number]): MarkerLike;
  addTo(map: MapLike): MarkerLike;
  remove(): unknown;
}

export interface MapLibreLike {
  Map: new (options: {
    container: HTMLElement;
    style: string;
    attributionControl: boolean;
    center: [number, number];
    zoom: number;
  }) => MapLike;
  Marker: new (options: { element: HTMLElement; anchor: "bottom" | "center" }) => MarkerLike;
  /** MapLibre 6 loads its worker from a separate file; the host says where. */
  setWorkerUrl?(url: string): void;
}
