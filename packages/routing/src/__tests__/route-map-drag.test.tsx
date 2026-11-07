import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { circleRing, createWebRouting, EN_US_ROUTE_MAP_COPY, metresPerPixel, offsetMetres, scaleReading, type MapLibreLike, type RouteMapProps, type RouteMapTheme } from "../react/index";

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

const SHOP = { lng: -43.961194, lat: -19.815217 };

interface FakeMarker {
  element: HTMLElement;
  options: { draggable?: boolean };
  listeners: Record<string, (() => void)[]>;
  lngLat: { lng: number; lat: number };
  draggable: boolean | undefined;
}

/** A MapLibre stand-in that records sources' data, markers' options and drag listeners. */
function fakeMapLibre(initialZoom = 13, canEase = true) {
  /** What the fake map reports as its zoom; a test zooms it by writing here. */
  const view = { zoom: initialZoom };
  const data = new Map<string, unknown>();
  const layers: Record<string, unknown>[] = [];
  const markers: FakeMarker[] = [];
  const eased: unknown[] = [];
  const fitted: unknown[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const lib: MapLibreLike = {
    Map: class {
      constructor({ container }: { container: HTMLElement }) {
        (this as unknown as { container: HTMLElement }).container = container;
      }
      on(event: string, listener: () => void) {
        (listeners[event] ??= []).push(listener);
      }
      remove() {}
      addSource(id: string, source: { data: unknown }) {
        data.set(id, source.data);
      }
      getSource(id: string) {
        return { setData: (next: unknown) => data.set(id, next) };
      }
      addLayer(layer: Record<string, unknown>) {
        layers.push(layer);
      }
      setPaintProperty() {}
      fitBounds(bounds: unknown) {
        fitted.push(bounds);
      }
      easeTo(options: unknown) {
        eased.push(options);
      }
      zoomIn() {}
      zoomOut() {}
      project([lng, lat]: [number, number]) {
        return { x: (lng - SHOP.lng) * 1000 + 200, y: (SHOP.lat - lat) * 1000 + 200 };
      }
      unproject([x, y]: [number, number]) {
        return { lng: (x - 200) / 1000 + SHOP.lng, lat: SHOP.lat - (y - 200) / 1000 };
      }
      getZoom() {
        return view.zoom;
      }
      getCenter() {
        return SHOP;
      }
    } as unknown as MapLibreLike["Map"],
    Marker: class {
      readonly fake: FakeMarker;
      constructor({ element, ...options }: { element: HTMLElement; draggable?: boolean }) {
        this.fake = { element, options, listeners: {}, lngLat: { lng: 0, lat: 0 }, draggable: undefined };
        markers.push(this.fake);
      }
      setLngLat([lng, lat]: [number, number]) {
        this.fake.lngLat = { lng, lat };
        return this;
      }
      getLngLat() {
        return this.fake.lngLat;
      }
      on(event: string, listener: () => void) {
        (this.fake.listeners[event] ??= []).push(listener);
      }
      setDraggable(value: boolean) {
        this.fake.draggable = value;
        return this;
      }
      addTo(map: { container: HTMLElement }) {
        map.container.appendChild(this.fake.element);
        return this;
      }
      remove() {
        this.fake.element.remove();
      }
    } as unknown as MapLibreLike["Marker"],
  };
  const fire = (event: string) => {
    for (const listener of listeners[event] ?? []) listener();
  };
  const constructed = () => (listeners.load?.length ?? 0) > 0;
  if (!canEase) Reflect.deleteProperty(lib.Map.prototype, "easeTo");
  return { lib, data, layers, markers, fire, constructed, view, eased, fitted };
}

async function mount(props: Partial<RouteMapProps>, zoom = 13, canEase = true) {
  const fake = fakeMapLibre(zoom, canEase);
  const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, loadMapLibre: async () => fake.lib });
  const view = render(<RouteMap height={400} {...props} />);
  await waitFor(() => expect(fake.constructed()).toBe(true));
  act(() => fake.fire("load"));
  return { ...view, fake, RouteMap };
}

/** Runs `body` with every element laid out `size` px square (jsdom lays nothing out), then restores jsdom's own getters. */
async function withFrameSize(size: number, body: () => Promise<void>): Promise<void> {
  const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(size);
  const height = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(size);
  try {
    await body();
  } finally {
    width.mockRestore();
    height.mockRestore();
  }
}

type Collection = { features: { properties: Record<string, unknown>; geometry: { coordinates: unknown } }[] };

afterEach(cleanup);

describe("RouteMap · a draggable place", () => {
  const drag = { ariaLabel: "Store pin. Drag it, or use the arrow keys, to move it" };

  it("is a focusable button with its accessible name, and a draggable marker", async () => {
    const { fake } = await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop: vi.fn() } }] });
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    expect(pin.style.touchAction).toBe("none");
    expect(fake.markers.find((marker) => marker.element === pin)?.options.draggable).toBe(true);
  });

  it("reports every move and the drop with MapLibre's position", async () => {
    const onMove = vi.fn();
    const onDrop = vi.fn();
    const { fake } = await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onMove, onDrop } }] });
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    const marker = fake.markers.find((item) => item.element === pin)!;
    marker.lngLat = { lng: -43.96, lat: -19.81 };
    act(() => marker.listeners.drag!.forEach((listener) => listener()));
    expect(onMove).toHaveBeenLastCalledWith({ lng: -43.96, lat: -19.81 });
    expect(onDrop).not.toHaveBeenCalled();
    marker.lngLat = { lng: -43.95, lat: -19.8 };
    act(() => marker.listeners.dragend!.forEach((listener) => listener()));
    expect(onDrop).toHaveBeenCalledWith({ lng: -43.95, lat: -19.8 });
  });

  it("an arrow key moves 50 m below the street zoom, as a move and a drop", async () => {
    const onMove = vi.fn();
    const onDrop = vi.fn();
    await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onMove, onDrop } }] }, 13);
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    fireEvent.keyDown(pin, { key: "ArrowUp" });
    const expected = offsetMetres(SHOP, 0, 50);
    expect(onDrop).toHaveBeenCalledWith(expected);
    expect(onMove).toHaveBeenCalledWith(expected);
    expect((expected.lat - SHOP.lat) * 111_320).toBeCloseTo(50, 5);
  });

  it("an arrow key moves 5 m at the street zoom, and the host's step wins", async () => {
    const onDrop = vi.fn();
    const first = await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop } }] }, 16);
    fireEvent.keyDown(await screen.findByRole("button", { name: drag.ariaLabel }), { key: "ArrowRight" });
    const east = onDrop.mock.calls[0]![0] as { lng: number; lat: number };
    expect(east.lat).toBe(SHOP.lat);
    expect((east.lng - SHOP.lng) * 111_320 * Math.cos((SHOP.lat * Math.PI) / 180)).toBeCloseTo(5, 5);
    first.unmount();
    const custom = vi.fn();
    await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop: custom, stepMetres: () => 10 } }] }, 16);
    fireEvent.keyDown(await screen.findByRole("button", { name: drag.ariaLabel }), { key: "ArrowDown" });
    expect((SHOP.lat - (custom.mock.calls[0]![0] as { lat: number }).lat) * 111_320).toBeCloseTo(10, 5);
  });

  it("steps from where the host has the pin, not from its own last step", async () => {
    const onDrop = vi.fn();
    await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop } }] }, 13);
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    fireEvent.keyDown(pin, { key: "ArrowUp" });
    fireEvent.keyDown(pin, { key: "ArrowUp" });
    // The host never passed the first step back: the second starts from SHOP again.
    expect(onDrop.mock.calls[1]![0]).toEqual(onDrop.mock.calls[0]![0]);
  });

  it("an arrow key keeps the pin inside the frame", async () => {
    await withFrameSize(400, async () => {
      const onDrop = vi.fn();
      await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop, stepMetres: () => 1_000_000 } }] }, 13);
      fireEvent.keyDown(await screen.findByRole("button", { name: drag.ariaLabel }), { key: "ArrowRight" });
      // 1 000 km east would leave a 400 px frame; the fake's x = (lng - SHOP.lng) * 1000 + 200 stops at 396.
      const at = onDrop.mock.calls[0]![0] as { lng: number; lat: number };
      expect((at.lng - SHOP.lng) * 1000 + 200).toBeCloseTo(396, 6);
      expect(at.lat).toBeCloseTo(SHOP.lat, 9);
    });
  });

  it("ignores other keys, and every key while disabled", async () => {
    const onDrop = vi.fn();
    const { fake, rerender, RouteMap } = await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop } }] });
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    fireEvent.keyDown(pin, { key: "Enter" });
    expect(onDrop).not.toHaveBeenCalled();
    rerender(<RouteMap height={400} places={[{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop, disabled: true } }]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: drag.ariaLabel }), { key: "ArrowUp" });
    expect(onDrop).not.toHaveBeenCalled();
    expect(fake.markers.find((marker) => marker.element.isConnected)?.draggable).toBe(false);
  });

  it("keeps the same element when the host moves it, so a focused pin stays focused", async () => {
    const onDrop = vi.fn();
    const { rerender, RouteMap } = await mount({ places: [{ id: "shop", position: SHOP, label: "Store", draggable: { ...drag, onDrop } }] });
    const pin = await screen.findByRole("button", { name: drag.ariaLabel });
    rerender(<RouteMap height={400} places={[{ id: "shop", position: offsetMetres(SHOP, 30, 0), label: "Store", draggable: { ...drag, onDrop } }]} />);
    expect(screen.getByRole("button", { name: drag.ariaLabel })).toBe(pin);
    expect(pin.isConnected).toBe(true);
  });

  it("an undraggable place stays a label the pointer passes through", async () => {
    await mount({ places: [{ id: "shop", position: SHOP, label: "Store" }] });
    expect(await screen.findByText("Store")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: drag.ariaLabel })).toHaveLength(0);
  });
});

describe("RouteMap · circles and dots", () => {
  it("draws each circle as a ring of its radius around its centre, redrawn when it moves", async () => {
    const circles = [{ id: "outer", center: SHOP, radiusMetres: 3000 }];
    const { fake, rerender, RouteMap } = await mount({ circles });
    await waitFor(() => expect((fake.data.get("routing-circles") as Collection).features).toHaveLength(1));
    const moved = offsetMetres(SHOP, 200, 0);
    rerender(<RouteMap height={400} circles={[{ id: "outer", center: moved, radiusMetres: 3000 }, { id: "ghost", center: SHOP, radiusMetres: 3000, dashed: true }]} />);
    const drawn = fake.data.get("routing-circles") as Collection;
    expect(drawn.features.map((feature) => feature.properties)).toEqual([
      { id: "outer", dashed: false, color: THEME.travelled },
      { id: "ghost", dashed: true, color: THEME.ink },
    ]);
    const ring = drawn.features[0]!.geometry.coordinates as [number, number][][];
    const lngs = ring[0]!.map(([lng]) => lng);
    // Centred on the moved point: the east and west extremes are symmetric about it.
    expect((Math.max(...lngs) + Math.min(...lngs)) / 2).toBeCloseTo(moved.lng, 9);
  });

  it("a ring's every point is its radius from the centre", () => {
    for (const [lng, lat] of circleRing({ id: "r", center: SHOP, radiusMetres: 1500 })) {
      const dy = (lat - SHOP.lat) * 111_320;
      const dx = (lng - SHOP.lng) * 111_320 * Math.cos((SHOP.lat * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1500, 3);
    }
  });

  it("drops an invalid circle and an invalid dot, and draws dots filled or hollow", async () => {
    const { fake } = await mount({
      circles: [{ id: "zero", center: { lng: 0, lat: 0 }, radiusMetres: 100 }, { id: "flat", center: SHOP, radiusMetres: 0 }],
      dots: [
        { id: "in", position: offsetMetres(SHOP, 100, 100), filled: true },
        { id: "out", position: offsetMetres(SHOP, 4000, 0), filled: false },
        { id: "bad", position: { lng: Number.NaN, lat: 1 }, filled: true },
      ],
    });
    await waitFor(() => expect((fake.data.get("routing-dots") as Collection).features).toHaveLength(2));
    expect((fake.data.get("routing-circles") as Collection).features).toHaveLength(0);
    expect((fake.data.get("routing-dots") as Collection).features.map((feature) => feature.properties)).toEqual([
      { id: "in", filled: true },
      { id: "out", filled: false },
    ]);
    expect(fake.layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining(["routing-circles-fill", "routing-circles-line", "routing-circles-dashed", "routing-dots"]),
    );
  });
});

describe("RouteMap · a place's colour, a ghost place and tethers", () => {
  it("fills a draggable pin and a label with the place's own colour", async () => {
    const drag = { ariaLabel: "Store pin", onDrop: () => {} };
    await mount({ places: [{ id: "shop", position: SHOP, label: "Store", color: "#b45", draggable: drag }, { id: "home", position: offsetMetres(SHOP, 300, 0), label: "Home", color: "#3a6" }] });
    const pin = await screen.findByRole("button", { name: "Store pin" });
    expect(pin.querySelector("path")!.getAttribute("fill")).toBe("#b45");
    expect((await screen.findByText("Home")).style.background).toBe("rgb(51, 170, 102)");
  });

  it("draws a ghost place as a dashed hollow ring with a quiet label, never a pin", async () => {
    await mount({ places: [{ id: "was", position: SHOP, label: "Address point", ghost: true, draggable: { ariaLabel: "Never", onDrop: () => {} } }] });
    const label = await screen.findByText("Address point");
    const ghost = label.closest<HTMLElement>("[data-routing-ghost]")!;
    expect(ghost.dataset.routingGhost).toBe("was");
    expect((ghost.firstElementChild as HTMLElement).style.border).toContain("dashed");
    expect(label.style.fontWeight).toBe("400");
    expect(screen.queryAllByRole("button", { name: "Never" })).toHaveLength(0);
  });

  it("draws each tether as a dashed line after the circles, and leaves it out of the fit", async () => {
    const far = offsetMetres(SHOP, 5000, 0);
    const { fake } = await mount({ circles: [{ id: "ring", center: SHOP, radiusMetres: 100 }], tethers: [{ id: "t", from: SHOP, to: far }, { id: "bad", from: SHOP, to: { lng: Number.NaN, lat: 0 } }], fitKey: "a" });
    await waitFor(() => expect((fake.data.get("routing-circles") as Collection).features).toHaveLength(2));
    const [, tether] = (fake.data.get("routing-circles") as Collection).features;
    expect(tether!.properties).toEqual({ id: "t", dashed: true, color: THEME.ink });
    expect(tether!.geometry.coordinates).toEqual([[SHOP.lng, SHOP.lat], [far.lng, far.lat]]);
    const [, [east]] = fake.fitted.at(-1) as [[number, number], [number, number]];
    expect(east).toBeLessThan(far.lng);
  });

  it("adds the shape layers for a map that draws only a tether", async () => {
    const { fake } = await mount({ tethers: [{ id: "t", from: SHOP, to: offsetMetres(SHOP, 50, 0), color: "#777" }] });
    await waitFor(() => expect((fake.data.get("routing-circles") as Collection).features).toHaveLength(1));
    expect((fake.data.get("routing-circles") as Collection).features[0]!.properties.color).toBe("#777");
  });
});

describe("RouteMap · this mount's words, kept zoom and the zoom it reports", () => {
  it("names the fit control with this mount's copy", async () => {
    await mount({ copy: { fitAll: "See all" } });
    expect(await screen.findByRole("button", { name: "See all" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: EN_US_ROUTE_MAP_COPY.fitAll })).toHaveLength(0);
  });

  it("draws the fit control as its word when asked, and still fits", async () => {
    const onFitAll = vi.fn();
    await mount({ copy: { fitAll: "See all" }, controls: { fitAsText: true }, onFitAll });
    const fit = await screen.findByRole("button", { name: "See all" });
    expect(fit.textContent).toBe("See all");
    expect(fit.querySelectorAll("svg")).toHaveLength(0);
    fireEvent.click(fit);
    expect(onFitAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the zoom buttons out of the narrow-width rule when asked", async () => {
    const first = await mount({});
    expect((await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn })).className).toBe("routing-zoom");
    first.unmount();
    await mount({ controls: { zoomWhenNarrow: true } });
    expect((await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn })).className).toBe("");
  });

  it("lets the host take over the zoom-out control", async () => {
    const onZoomOut = vi.fn();
    await mount({ controls: { onZoomOut } });
    fireEvent.click(await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomOut }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("reports the zoom when ready and once per change, never for a pan", async () => {
    const onZoomChange = vi.fn();
    const mounted = await mount({ onZoomChange }, 14);
    await waitFor(() => expect(onZoomChange).toHaveBeenCalledWith(14));
    onZoomChange.mockClear();
    act(() => mounted.fake.fire("moveend"));
    expect(onZoomChange).not.toHaveBeenCalled();
    mounted.fake.view.zoom = 16;
    act(() => {
      mounted.fake.fire("zoomend");
      mounted.fake.fire("moveend");
    });
    expect(onZoomChange.mock.calls).toEqual([[16]]);
  });
});

describe("RouteMap · the scale bar", () => {
  it("measures metres per pixel as MapLibre draws (512-px tiles, by latitude)", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
    expect(metresPerPixel(16, 60)).toBeCloseTo(metresPerPixel(16, 0) / 2, 6);
  });

  it("takes the longest nice length within a quarter of the width", () => {
    // Zoom 16 at -19.8°: ~1.12 m/px, so a 400 px map's quarter is ~112 m.
    expect(scaleReading(16, SHOP.lat, 400)).toEqual({ metres: 100, px: Math.round(100 / metresPerPixel(16, SHOP.lat)) });
    expect(scaleReading(13, SHOP.lat, 400).metres).toBe(500);
    expect(scaleReading(22, SHOP.lat, 100).metres).toBe(50);
  });

  it("is drawn only when the host words it", async () => {
    const first = await mount({}, 16);
    expect(document.querySelectorAll("[data-routing-scale]")).toHaveLength(0);
    first.unmount();
    await withFrameSize(400, async () => {
      await mount({ scaleBar: (metres) => `${metres} m` }, 16);
      expect(await screen.findByText("100 m")).toBeTruthy();
    });
  });
});

describe("RouteMap · a focus at a zoom", () => {
  it("centres on the points at exactly the zoom asked, without a fit", async () => {
    const { fake } = await mount({ focus: { key: "street", points: [[SHOP.lng, SHOP.lat]], zoom: 16 } });
    await waitFor(() =>
      expect(fake.eased).toEqual([{ center: [SHOP.lng, SHOP.lat], zoom: 16, padding: { top: 40, right: 76, bottom: 48, left: 40 }, duration: 300 }]),
    );
    expect(fake.fitted).toEqual([]);
  });

  it("keeps the host's insets clear when it centres", async () => {
    const { fake } = await mount({ focus: { key: "street", points: [[SHOP.lng, SHOP.lat]], zoom: 16 }, insets: { bottom: 60 } });
    await waitFor(() => expect(fake.eased).toHaveLength(1));
    expect(fake.eased[0]).toMatchObject({ padding: { bottom: 108 } });
  });

  it("falls back to the fit on a map that cannot ease", async () => {
    const { fake } = await mount({ focus: { key: "street", points: [[SHOP.lng, SHOP.lat]], zoom: 16 } }, 13, false);
    await waitFor(() => expect(fake.fitted.length).toBeGreaterThan(0));
    expect(fake.eased).toEqual([]);
  });

  it("fits as before when no zoom is asked", async () => {
    const { fake } = await mount({ focus: { key: "trip", points: [[SHOP.lng, SHOP.lat]] } });
    await waitFor(() => expect(fake.fitted.length).toBeGreaterThan(0));
    expect(fake.eased).toEqual([]);
  });
});
