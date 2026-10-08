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
  /** Each marker element's last `setOffset`, as MapLibre would apply it. */
  const offsets = new Map<HTMLElement, [number, number]>();
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
      setOffset(offset: [number, number]) {
        offsets.set(this.element, offset);
        return this;
      }
    } as unknown as MapLibreLike["Marker"],
  };
  return { lib, maps, offsets };
}

const MARKERS: RouteMapProps["markers"] = [
  { id: "a", position: { lng: -46.63, lat: -23.55 }, text: "MD", ariaLabel: "Márcio, Em rota", color: "#a40", onSelect: () => undefined },
  { id: "b", position: { lng: -46.5, lat: -23.4 }, text: "RS", ariaLabel: "Rafa, Em rota", color: "#a40", onSelect: () => undefined },
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

  it("draws a marker's and a place's glyph before its text", async () => {
    await mount({ markers: [{ ...MARKERS[0]!, icon: "motorbike" }], places: [{ id: "shop", position: { lng: -46.6, lat: -23.5 }, label: "Store", icon: "store" }] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    expect(marker.querySelector("svg")).not.toBeNull();
    expect(marker.textContent).toBe("MD");
    const place = await screen.findByText("Store");
    expect(place.querySelector("svg")).not.toBeNull();
    // Lifted above a pin standing on the same point, drawn under the pins so
    // the stem never crosses a name, and never in the way of a click.
    const wrapper = place.parentElement!;
    expect(wrapper.style.pointerEvents).toBe("none");
    expect(wrapper.style.zIndex).toBe("1");
  });

  it("draws a place's label on its point when asked, without the lift's padding", async () => {
    const { fake } = await mount({ places: [{ id: "shop", position: { lng: -46.6, lat: -23.5 }, label: "Store" }], placeLabels: "at-point" });
    const place = await screen.findByText("Store");
    expect(place.parentElement!.children).toHaveLength(1);
    expect(fake.maps[0]!.fitBounds.mock.calls[0]?.[1]).toMatchObject({ padding: { top: 40 } });
  });

  it("shows a compact attribution that opens to the full credit and folds again", async () => {
    await mount({ attribution: "compact" });
    const toggle = screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.attribution });
    expect(toggle.textContent).toBe("i");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const open = await screen.findByText(EN_US_ROUTE_MAP_COPY.attribution);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.attribution }).textContent).toBe("i");
  });

  it("shows the full credit by default, with nothing to press", async () => {
    await mount();
    expect(screen.getByText(EN_US_ROUTE_MAP_COPY.attribution).tagName).toBe("SMALL");
    await waitFor(() => expect(screen.queryByRole("button", { name: EN_US_ROUTE_MAP_COPY.attribution })).toBeNull());
  });

  it("follows the attribution prop after mount", async () => {
    const { rerender, RouteMap } = await mount({ attribution: "compact" });
    fireEvent.click(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.attribution }));
    rerender(<RouteMap height={400} markers={MARKERS} attribution="full" />);
    expect(screen.getByText(EN_US_ROUTE_MAP_COPY.attribution).tagName).toBe("SMALL");
    rerender(<RouteMap height={400} markers={MARKERS} attribution="compact" />);
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.attribution }).textContent).toBe("i");
  });

  it("redraws a place's label when placeLabels changes", async () => {
    const places = [{ id: "shop", position: { lng: -46.6, lat: -23.5 }, label: "Store" }];
    const { rerender, RouteMap } = await mount({ places });
    expect((await screen.findByText("Store")).parentElement!.children.length).toBeGreaterThan(1);
    rerender(<RouteMap height={400} markers={MARKERS} places={places} placeLabels="at-point" />);
    await waitFor(() => expect(screen.getByText("Store").parentElement!.children).toHaveLength(1));
  });

  it("draws an emphasised stop above the pins and the rest beneath", async () => {
    await mount({
      stops: [
        { id: "a", position: { lng: -46.61, lat: -23.51 }, mark: "1", title: "Parada 1", variant: "done" },
        { id: "b", position: { lng: -46.62, lat: -23.52 }, mark: "2", title: "Parada 2 — este pedido", variant: "next", emphasized: true },
      ],
    });
    expect((await screen.findByRole("img", { name: "Parada 1" })).style.zIndex).toBe("1");
    expect(screen.getByRole("img", { name: "Parada 2 — este pedido" }).style.zIndex).toBe("4");
  });

  it("marks the zoom pair so a phone-width map can hide it", async () => {
    await mount();
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn }).className).toBe("routing-zoom");
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.fitAll }).className).toBe("");
    expect(document.getElementById("routing-map-css")?.textContent).toContain("@container routing-map (max-width: 599px)");
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

  it("keeps fitted content clear of the host's own overlays", async () => {
    const { fake } = await mount({ insets: { bottom: 40, left: 8 } });
    expect(fake.maps[0]!.fitBounds.mock.calls[0]?.[1]).toMatchObject({ padding: { top: 40, bottom: 88, left: 48, right: 76 } });
  });

  it("fits to a focused selection when its key changes, not on a refresh", async () => {
    const { fake, rerender, RouteMap } = await mount();
    const points: [number, number][] = [[-46.6, -23.5], [-46.7, -23.6]];
    rerender(<RouteMap height={400} markers={MARKERS} focus={{ key: "rider-1", points }} />);
    await waitFor(() => expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(2));
    expect(fake.maps[0]!.fitBounds.mock.calls[1]?.[0]).toEqual([[-46.7, -23.6], [-46.6, -23.5]]);
    rerender(<RouteMap height={400} markers={[...MARKERS!]} focus={{ key: "rider-1", points: [...points] }} />);
    expect(fake.maps[0]!.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("puts the controls in the top-left corner and pads the fit on that side", async () => {
    const { fake } = await mount({ controls: { placement: "top-left" } });
    const fitButton = screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.fitAll });
    expect(fitButton.parentElement?.style.left).toBe("12px");
    expect(fake.maps[0]!.fitBounds.mock.calls[0]?.[1]).toMatchObject({ padding: { left: 76, right: 40 } });
  });

  it("leaves room above a place for its lifted label, and ignores a bad inset", async () => {
    const { fake } = await mount({ places: [{ id: "shop", position: { lng: -46.6, lat: -23.5 }, label: "Store" }], insets: { bottom: Number.NaN, left: -20 } });
    expect(fake.maps[0]!.fitBounds.mock.calls[0]?.[1]).toMatchObject({ padding: { top: 120, bottom: 48, left: 40, right: 76 } });
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

  it("draws the travelled parts as separate strokes, dropping a lone point", async () => {
    const { fake } = await mount({
      travelled: [
        [-46.6, -23.5],
        [-46.5, -23.4],
      ],
      travelledParts: [
        [
          [-46.63, -23.55],
          [-46.62, -23.54],
        ],
        [[-46.6, -23.5]],
        [
          [-46.5, -23.4],
          [-46.49, -23.39],
        ],
      ],
    });
    const travelled = fake.maps[0]!.setData.mock.calls.map(([data]) => data as { geometry: { type: string } });
    expect(travelled).toContainEqual(
      expect.objectContaining({
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [-46.63, -23.55],
              [-46.62, -23.54],
            ],
            [
              [-46.5, -23.4],
              [-46.49, -23.39],
            ],
          ],
        },
      }),
    );
    expect(travelled.filter((data) => data.geometry.type === "LineString")).toHaveLength(1);
  });

  it("shows the host's error copy with a retry when the map cannot render", async () => {
    await mount({}, { failConstruct: true });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining(EN_US_ROUTE_MAP_COPY.mapError));
    await waitFor(() => expect(screen.queryByRole("button", { name: EN_US_ROUTE_MAP_COPY.zoomIn })).toBeNull());
    expect(screen.getByRole("button", { name: EN_US_ROUTE_MAP_COPY.retry })).toBeTruthy();
  });

  it("ignores an error after the map is ready (a tile, not the map)", async () => {
    const { fake } = await mount({}, { failConstruct: false });
    expect(await screen.findByRole("button", { name: "Márcio, Em rota" })).toBeTruthy();
    act(() => fake.maps[0]!.fire("error"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows the error when the style never arrives, instead of a blank map forever", async () => {
    const fake = fakeMapLibre();
    const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, loadMapLibre: async () => fake.lib, readyTimeoutMs: 30 });
    render(<RouteMap height={400} markers={MARKERS} overlay={<span>Legend</span>} />);
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    // No `style.load`, no `error`: the request hung.
    expect(await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.retry })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Legend")).toBeNull());
    expect(screen.getByRole("region").getAttribute("data-state")).toBe("error");
  });

  it("shows the error when the library itself never arrives", async () => {
    const { RouteMap } = createWebRouting({
      copy: EN_US_ROUTE_MAP_COPY,
      theme: THEME,
      loadMapLibre: () => new Promise<never>(() => undefined),
      readyTimeoutMs: 30,
    });
    render(<RouteMap height={400} markers={MARKERS} />);
    expect(await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.retry })).toBeTruthy();
  });

  it("shows the error when the style fails before the map is ready, and Retry builds a fresh map", async () => {
    const fake = fakeMapLibre();
    const { RouteMap } = createWebRouting({ copy: EN_US_ROUTE_MAP_COPY, theme: THEME, loadMapLibre: async () => fake.lib });
    render(<RouteMap height={400} markers={MARKERS} />);
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire("error"));
    fireEvent.click(await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.retry }));
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(fake.maps[0]!.removed).toBe(true);
    act(() => fake.maps[1]!.fire("style.load"));
    expect(await screen.findByRole("button", { name: "Márcio, Em rota" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fake.maps[1]!.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("keeps keyboard focus on a marker across a refresh, a selection and a pan", async () => {
    const { fake, rerender, RouteMap } = await mount();
    const button = await screen.findByRole("button", { name: "Márcio, Em rota" });
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real focus: what is under test is that a redraw keeps `document.activeElement`, so the marker has to hold it for real
    button.focus();
    rerender(<RouteMap height={400} markers={MARKERS!.map((marker) => ({ ...marker }))} />);
    await waitFor(() => expect(document.activeElement).toBe(button));
    act(() => fake.maps[0]!.fire("moveend"));
    await waitFor(() => expect(document.activeElement).toBe(button));
    rerender(<RouteMap height={400} markers={MARKERS!.map((marker, i) => ({ ...marker, emphasized: i === 0, text: i === 0 ? "Márcio" : marker.text }))} />);
    const replaced = screen.getByRole("button", { name: "Márcio, Em rota" });
    expect(replaced.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(replaced));
  });

  it("calls the host's current onSelect from a marker it kept", async () => {
    const { rerender, RouteMap } = await mount();
    const later = vi.fn();
    rerender(<RouteMap height={400} markers={[{ ...MARKERS![0]!, onSelect: later }, MARKERS![1]!]} />);
    fireEvent.click(screen.getByRole("button", { name: "Márcio, Em rota" }));
    expect(later).toHaveBeenCalledOnce();
  });

  it("draws a marker nobody can act on as a labelled image, not an empty button", async () => {
    await mount({ markers: [{ ...MARKERS![0]!, onSelect: undefined }] });
    expect(await screen.findByRole("img", { name: "Márcio, Em rota" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Márcio, Em rota" })).toBeNull());
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

/** A marker's pill, as laid out (jsdom lays nothing out, so the stub below does). */
const PILL = { width: 50, height: 26 };
const TAIL = 9;

/** Layout sizes by what each element is: a marker frame, its pill, a stop, a place. */
function layoutOf(element: HTMLElement): [number, number] {
  const parent = element.parentElement;
  if (element.style.minWidth === "44px") {
    const row = element.style.flexDirection.startsWith("row");
    return row ? [Math.max(PILL.width + TAIL, 44), Math.max(PILL.height, 44)] : [Math.max(PILL.width, 44), Math.max(PILL.height + TAIL, 44)];
  }
  if (parent?.style.minWidth === "44px" && parent.firstElementChild === element) return [PILL.width, PILL.height];
  if (element.style.width === "28px") return [28, 28];
  if (element.style.borderRadius === "10px") return [60, 26];
  if (element.style.pointerEvents === "none") return [60, element.children.length > 1 ? 80 : 26];
  return [0, 0];
}

/** Where a place's label sits inside its wrapper (MapLibre's marker is its offset parent). */
function offsetOf(element: HTMLElement, label: [number, number]): [number, number] {
  return element.style.borderRadius === "10px" ? label : [0, 0];
}

function stubLayout(container: { width: number; height: number } = { width: 0, height: 0 }, label: [number, number] = [0, 0]): void {
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return offsetOf(this, label)[0];
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    return offsetOf(this, label)[1];
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return layoutOf(this)[0];
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return layoutOf(this)[1];
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(container.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(container.height);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The visible tag (pill and tail) on `side` of a pin at screen `pin`, recomputed here independently. */
function tagBoxAt(pin: { x: number; y: number }, side: string): Box {
  const { width, height } = PILL;
  const sides: Record<string, Box> = {
    above: { left: pin.x - width / 2, right: pin.x + width / 2, top: pin.y - height - TAIL, bottom: pin.y },
    below: { left: pin.x - width / 2, right: pin.x + width / 2, top: pin.y, bottom: pin.y + TAIL + height },
    right: { left: pin.x, right: pin.x + TAIL + width, top: pin.y - height / 2, bottom: pin.y + height / 2 },
    left: { left: pin.x - TAIL - width, right: pin.x, top: pin.y - height / 2, bottom: pin.y + height / 2 },
  };
  return sides[side]!;
}

function centredBox(at: { x: number; y: number }, width: number, height: number): Box {
  return { left: at.x - width / 2, right: at.x + width / 2, top: at.y - height / 2, bottom: at.y + height / 2 };
}

function intersects(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/** The fake projects 1 degree to 1000 px, so a pin at (0.1, 0.1) sits at (100, 100) on screen. */
const PIN = { x: 100, y: 100 };
const COURIER = { id: "m", position: { lng: 0.1, lat: 0.1 }, text: "Márcio", ariaLabel: "Márcio, Em rota", color: "#a40", icon: "motorbike" as const, onSelect: () => undefined };

function stopAt(id: string, x: number, y: number) {
  return { id, position: { lng: x / 1000, lat: y / 1000 }, mark: id, title: `Parada ${id}`, variant: "next" as const };
}

describe("RouteMap's marker tags", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves a courier's tag below his pin when a stop badge sits where the tag would be", async () => {
    stubLayout();
    const { fake } = await mount({ markers: [COURIER], stops: [stopAt("2", 100, 80)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    expect(intersects(tagBoxAt(PIN, "below"), centredBox({ x: 100, y: 80 }, 28, 28))).toBe(false);
    // The frame's top now sits on the point and the tail points up at it.
    expect(fake.offsets.get(marker)).toEqual([0, 44]);
    expect(marker.style.flexDirection).toBe("column-reverse");
    expect(marker.lastElementChild!.getAttribute("style")).toContain("border-bottom: 9px solid");
  });

  it("moves a courier's tag off a place label drawn on its point", async () => {
    stubLayout();
    await mount({ markers: [COURIER], places: [{ id: "shop", position: { lng: 0.1, lat: 0.085 }, label: "Loja" }], placeLabels: "at-point" });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    expect(intersects(tagBoxAt(PIN, "below"), centredBox({ x: 100, y: 85 }, 60, 26))).toBe(false);
  });

  it("keeps the tag above when nothing is in the way, untouched", async () => {
    stubLayout();
    const { fake } = await mount({ markers: [COURIER], stops: [stopAt("2", 100, 300)], places: [{ id: "shop", position: { lng: 0.1, lat: 0.1 }, label: "Loja" }] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    // A lifted place's LABEL rides above the pin's tag; its stem is not in the way.
    expect(marker.dataset.tagSide).toBe("above");
    expect(fake.offsets.has(marker)).toBe(false);
    expect(marker.style.flexDirection).toBe("column");
  });

  it("keeps the tag inside the map when above would leave it", async () => {
    stubLayout({ width: 245, height: 200 });
    await mount({ markers: [{ ...COURIER, position: { lng: 0.1, lat: 0.03 } }] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
  });

  it("takes the least-overlapping side when every side is blocked", async () => {
    stubLayout();
    // Above and below are covered whole (784 px²); right only clips a badge (460 px²); left is worse (980 px²).
    const stops = [stopAt("1", 100, 82), stopAt("2", 100, 118), stopAt("3", 165, 100), stopAt("4", 60, 100)];
    const { fake } = await mount({ markers: [COURIER], stops });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("right"));
    expect(fake.offsets.get(marker)).toEqual([(PILL.width + TAIL) / 2, 22]);
  });

  it("keeps the tag above a courier standing on a stop (arrival), instead of jumping aside", async () => {
    stubLayout();
    await mount({ markers: [COURIER], stops: [stopAt("2", 100, 100)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    expect(marker.dataset.tagSide).toBe("above");
  });

  it("keeps a stable side while a pin jitters across a stop's edge, and steps aside once clearly off it", async () => {
    stubLayout();
    // The badge spans x 86–114; the pin sits `dx` px left of its centre, crossing its edge at 14.
    const stops = [stopAt("2", 100, 100)];
    const at = (dx: number) => [{ ...COURIER, position: { lng: (100 - dx) / 1000, lat: 0.1 } }];
    const { rerender, RouteMap } = await mount({ markers: at(13), stops });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    const sideAt = (dx: number): string => {
      rerender(<RouteMap height={400} markers={at(dx)} stops={stops} />);
      return marker.dataset.tagSide ?? "";
    };
    expect([13, 15, 13, 15, 13.5, 14.5].map(sideAt)).toEqual(["above", "above", "above", "above", "above", "above"]);
    expect(sideAt(22)).not.toBe("above");
  });

  it("does not treat a pin arriving just off a badge's edge as standing on it", async () => {
    stubLayout();
    // 4 px off the badge's edge — within the release margin, but the pin never stood on it.
    await mount({ markers: [{ ...COURIER, position: { lng: 0.082, lat: 0.1 } }], stops: [stopAt("2", 100, 100)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("left"));
  });

  it("does not flip back and forth as a pin jitters a pixel or two at the threshold", async () => {
    stubLayout();
    // A badge whose bottom edge is at y=64: above the pin at y=98 it clips the tag by 1 px; at y=100 it clears it by 1 px.
    const stops = [stopAt("2", 100, 50)];
    const { rerender, RouteMap } = await mount({ markers: [{ ...COURIER, position: { lng: 0.1, lat: 0.098 } }], stops });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    const sideAt = (lat: number): string => {
      rerender(<RouteMap height={400} markers={[{ ...COURIER, position: { lng: 0.1, lat } }]} stops={stops} />);
      return marker.dataset.tagSide ?? "";
    };
    expect([0.1, 0.098, 0.1, 0.0985, 0.1].map(sideAt)).toEqual(["below", "below", "below", "below", "below"]);
  });

  it("takes the left side when above, below and right are each blocked", async () => {
    stubLayout();
    const { fake } = await mount({ markers: [COURIER], stops: [stopAt("1", 115, 75), stopAt("2", 115, 125), stopAt("3", 130, 100)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("left"));
    expect(fake.offsets.get(marker)).toEqual([-(PILL.width + TAIL) / 2, 22]);
    expect(marker.style.flexDirection).toBe("row");
    expect(marker.lastElementChild!.getAttribute("style")).toContain("border-left: 9px solid");
  });

  it("returns the tag above once the obstacle has gone", async () => {
    stubLayout();
    const { fake, rerender, RouteMap } = await mount({ markers: [COURIER], stops: [stopAt("2", 100, 80)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    rerender(<RouteMap height={400} markers={[COURIER]} stops={[]} />);
    await waitFor(() => expect(marker.dataset.tagSide).toBe("above"));
    expect(fake.offsets.get(marker)).toEqual([0, 0]);
    expect(marker.style.flexDirection).toBe("column");
    expect(marker.lastElementChild!.getAttribute("style")).toContain("border-top: 9px solid");
  });

  it("moves a group's pill off a stop badge too", async () => {
    stubLayout();
    const near = { ...COURIER, id: "n", ariaLabel: "Rafa, Em rota", position: { lng: 0.10001, lat: 0.10001 } };
    await mount({ markers: [COURIER, near], stops: [stopAt("2", 100, 80)] });
    const group = await screen.findByRole("button", { name: EN_US_ROUTE_MAP_COPY.group(2) });
    await waitFor(() => expect(group.dataset.tagSide).toBe("below"));
  });

  it("measures a lifted place by its label's own box inside the wrapper", async () => {
    // The wrapper (60×80) spans y 70–150 above its point at y=150. With the label at the
    // wrapper's top it would cover the tag above the pin; laid out 54 px lower it covers only below.
    stubLayout(undefined, [0, 54]);
    await mount({ markers: [COURIER], places: [{ id: "shop", position: { lng: 0.1, lat: 0.15 }, label: "Loja" }] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    expect(marker.dataset.tagSide).toBe("above");
  });

  it("covers a lifted label at the wrapper's top, so the tag steps below", async () => {
    stubLayout();
    await mount({ markers: [COURIER], places: [{ id: "shop", position: { lng: 0.1, lat: 0.15 }, label: "Loja" }] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
  });

  it("keeps every tag above, untouched, with tagPlacement=fixed — and puts a moved one back", async () => {
    stubLayout();
    const stops = [stopAt("2", 100, 80)];
    const { fake, rerender, RouteMap } = await mount({ markers: [COURIER], stops, tagPlacement: "fixed" });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    expect(marker.dataset.tagSide).toBe("above");
    expect(fake.offsets.has(marker)).toBe(false);
    rerender(<RouteMap height={400} markers={[COURIER]} stops={stops} />);
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    rerender(<RouteMap height={400} markers={[COURIER]} stops={stops} tagPlacement="fixed" />);
    await waitFor(() => expect(marker.dataset.tagSide).toBe("above"));
    expect(fake.offsets.get(marker)).toEqual([0, 0]);
  });

  it("keeps keyboard focus on a marker whose tag changes side", async () => {
    stubLayout();
    const { fake, rerender, RouteMap } = await mount({ markers: [COURIER], stops: [stopAt("2", 100, 300)] });
    const marker = await screen.findByRole("button", { name: "Márcio, Em rota" });
    expect(marker.dataset.tagSide).toBe("above");
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real focus: what is under test is that a re-placement keeps `document.activeElement`
    marker.focus();
    rerender(<RouteMap height={400} markers={[{ ...COURIER }]} stops={[stopAt("2", 100, 80)]} />);
    await waitFor(() => expect(marker.dataset.tagSide).toBe("below"));
    act(() => fake.maps[0]!.fire("zoomend"));
    act(() => fake.maps[0]!.fire("moveend"));
    await waitFor(() => expect(document.activeElement).toBe(marker));
    expect(screen.getByRole("button", { name: "Márcio, Em rota" })).toBe(marker);
  });
});
