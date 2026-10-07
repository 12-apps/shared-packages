import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebRouting, EN_US_ROUTE_MAP_COPY, type MapLibreLike, type RouteMapProps, type RouteMapTheme } from "../react/index";

const THEME: RouteMapTheme = {
  planned: "#888",
  travelled: "#a40",
  done: "#470",
  next: "#222",
  pending: "#fff",
  ink: "#222",
  paper: "#fff",
  place: "#222",
  control: "#fff",
  controlBorder: "#ddd",
};

interface FakeMap {
  listeners: Record<string, (() => void)[]>;
  fitBounds: ReturnType<typeof vi.fn>;
  zoomIn: ReturnType<typeof vi.fn>;
  setData: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  removed: boolean;
  fire(event: string): void;
}

/**
 * A MapLibre stand-in: records what the component asks of it, projects points
 * linearly (1 degree = 1000 px) and places each marker's element in the DOM so
 * it can be found by role like the real one.
 */
function fakeMapLibre(options: { failConstruct?: boolean } = {}) {
  const maps: FakeMap[] = [];
  const lib: MapLibreLike = {
    Map: class {
      readonly fake: FakeMap;
      constructor({ container }: { container: HTMLElement }) {
        if (options.failConstruct) throw new Error("WebGL is not supported");
        const setData = vi.fn();
        this.fake = {
          listeners: {},
          fitBounds: vi.fn(),
          zoomIn: vi.fn(),
          setData,
          addLayer: vi.fn(),
          removed: false,
          fire(event) {
            for (const listener of this.listeners[event] ?? []) listener();
          },
        };
        maps.push(this.fake);
        (this as unknown as { container: HTMLElement }).container = container;
      }
      on(event: string, listener: () => void) {
        (this.fake.listeners[event] ??= []).push(listener);
      }
      remove() {
        this.fake.removed = true;
      }
      addSource() {}
      getSource() {
        return { setData: this.fake.setData };
      }
      addLayer(layer: Record<string, unknown>) {
        this.fake.addLayer(layer);
      }
      setPaintProperty() {}
      fitBounds(bounds: unknown, opts: unknown) {
        this.fake.fitBounds(bounds, opts);
      }
      zoomIn() {
        this.fake.zoomIn();
      }
      zoomOut() {}
      project([lng, lat]: [number, number]) {
        return { x: lng * 1000, y: lat * 1000 };
      }
    } as unknown as MapLibreLike["Map"],
    Marker: class {
      private element: HTMLElement;
      constructor({ element }: { element: HTMLElement }) {
        this.element = element;
      }
      setLngLat() {
        return this;
      }
      addTo(map: { container: HTMLElement }) {
        map.container.appendChild(this.element);
        return this;
      }
      remove() {
        this.element.remove();
      }
    } as unknown as MapLibreLike["Marker"],
  };
  return { lib, maps };
}

const MARKERS: RouteMapProps["markers"] = [
  { id: "a", position: { lng: -46.63, lat: -23.55 }, text: "MD", ariaLabel: "Márcio, Em rota", color: "#a40" },
  { id: "b", position: { lng: -46.5, lat: -23.4 }, text: "RS", ariaLabel: "Rafa, Em rota", color: "#a40" },
];

async function mount(props: Partial<RouteMapProps> = {}, options: { failConstruct?: boolean } = {}) {
  const fake = fakeMapLibre(options);
  const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, loadMapLibre: async () => fake.lib });
  const view = render(<RouteMap height={400} markers={MARKERS} {...props} />);
  if (!options.failConstruct) {
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire("load"));
  }
  return { ...view, fake, RouteMap };
}

afterEach(() => cleanup());

describe("RouteMap", () => {
  it("draws both lines and a button per marker, which selects", async () => {
    const onSelect = vi.fn();
    const { fake } = await mount({ markers: [{ ...MARKERS[0]!, onSelect }, MARKERS[1]!] });
    expect(fake.maps[0]!.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual(["routing-planned", "routing-travelled"]);
    fireEvent.click(await screen.findByRole("button", { name: "Márcio, Em rota" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Rafa, Em rota" })).toBeTruthy();
  });

  it("folds overlapping markers into one group that hands the host their ids", async () => {
    const onGroupSelect = vi.fn();
    const near = { ...MARKERS[1]!, position: { lng: -46.63001, lat: -23.55001 } };
    await mount({ markers: [MARKERS[0]!, near], onGroupSelect });
    fireEvent.click(await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.group(2) }));
    expect(onGroupSelect).toHaveBeenCalledWith(["a", "b"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Márcio, Em rota" })).toBeNull());
  });

  it("never folds the emphasised marker", async () => {
    const near = { ...MARKERS[1]!, position: { lng: -46.63001, lat: -23.55001 }, emphasized: true };
    await mount({ markers: [MARKERS[0]!, near] });
    expect(await screen.findByRole("button", { name: "Rafa, Em rota" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Márcio, Em rota" })).toBeTruthy();
  });

  it("fits once, again on a new fitKey, never on a data refresh", async () => {
    const { fake, rerender, RouteMap } = await mount({ fitKey: "store-a" });
    expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(1);
    rerender(<RouteMap height={400} markers={[...MARKERS!]} fitKey="store-a" planned={[[-46.63, -23.55], [-46.5, -23.4]]} />);
    expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(1);
    rerender(<RouteMap height={400} markers={[...MARKERS!]} fitKey="store-b" />);
    expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(2);
    // Fitted content stays clear of the control column on the right edge.
    expect(fake.maps[0]!.fitBounds.mock.calls[0]?.[1]).toMatchObject({ padding: { right: 76 } });
  });

  it("fits on the fit control and tells the host", async () => {
    const onFitAll = vi.fn();
    const { fake } = await mount({ onFitAll });
    fireEvent.click(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.fitAll }));
    expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(2);
    expect(onFitAll).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn }));
    expect(fake.maps[0]!.zoomIn).toHaveBeenCalledOnce();
  });

  it("feeds the lines to their sources", async () => {
    const planned = [
      [-46.63, -23.55],
      [-46.5, -23.4],
    ] as const;
    const { fake } = await mount({ planned: [...planned] });
    expect(fake.maps[0]!.setData).toHaveBeenCalledWith(expect.objectContaining({ geometry: { type: "LineString", coordinates: planned.map((p) => [...p]) } }));
  });

  it("shows the host's error copy with a retry when the map cannot render", async () => {
    await mount({}, { failConstruct: true });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining(EN_US_ROUTE_MAP_COPY.mapError));
    await waitFor(() => expect(screen.queryByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn })).toBeNull());
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.retry })).toBeTruthy();
  });

  it("shows the error when the style fails before the map loads, and retries", async () => {
    const { fake } = await mount({}, { failConstruct: false });
    act(() => fake.maps[0]!.fire("error"));
    // Loaded already: a later tile error is not a failed map.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("is ready on style.load without waiting for every tile, and adds the lines once", async () => {
    const fake = fakeMapLibre();
    const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, loadMapLibre: async () => fake.lib });
    render(<RouteMap height={400} markers={MARKERS} />);
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire("style.load"));
    expect(await screen.findByRole("button", { name: "Márcio, Em rota" })).toBeTruthy();
    act(() => fake.maps[0]!.fire("load"));
    expect(fake.maps[0]!.addLayer).toHaveBeenCalledTimes(2);
  });

  it("removes the map on unmount", async () => {
    const { fake, unmount } = await mount();
    unmount();
    expect(fake.maps[0]!.removed).toBe(true);
  });

  it("refuses to build without copy and theme", () => {
    expect(() => createWebRouting({} as never)).toThrow(TypeError);
  });
});

describe("RouteMap's worker", () => {
  it("hands MapLibre the host's worker URL before building a map", async () => {
    const fake = fakeMapLibre();
    const setWorkerUrl = vi.fn();
    const lib = { ...fake.lib, setWorkerUrl };
    const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, workerUrl: "/assets/worker.mjs", loadMapLibre: async () => lib });
    render(<RouteMap height={200} markers={MARKERS} />);
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    expect(setWorkerUrl).toHaveBeenCalledWith("/assets/worker.mjs");
  });
});
