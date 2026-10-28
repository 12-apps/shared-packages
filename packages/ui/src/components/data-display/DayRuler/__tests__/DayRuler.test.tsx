/**
 * DayRuler driven through the DOM (FUT-3825): create by drag and by a click
 * alone, move, resize either end, snapping and clamping, block click, touch,
 * the keyboard twins with their live region, and the states.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PT_BR_UI_LABELS } from "../../../../pt-BR.labels";
import { DayRuler } from "../DayRuler";
import { createdSpan, formatHour, formatRange, hourAt, moved, percentOf, resized, ticksOf } from "../day-ruler-model";
import type { DayRulerProps } from "../DayRuler.types";

/** The track is 200px wide from x = 0: one hour is 10px on the 06→26 ruler. */
const PX_PER_HOUR = 10;
const x = (hour: number): number => (hour - 6) * PX_PER_HOUR;

beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventPolyfill, configurable: true });
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
    const width = this.hasAttribute("data-dr-track") ? 200 : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40, width, height: 40, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(cleanup);
afterAll(() => {
  vi.restoreAllMocks();
});

function renderRuler(overrides: Partial<DayRulerProps> = {}) {
  const props: DayRulerProps = {
    rows: [
      {
        id: "luiz",
        label: "Luiz entrega",
        meta: "atrasado · era 20:39",
        group: "Entregas",
        blocks: [{ id: "b1", start: 20.65, end: 24, label: "↻ 20:39–00:00", tone: "late", movable: true, resizable: true }],
        actions: <button type="button">Iniciar agora</button>,
      },
      {
        id: "ana",
        label: "Anderson Paiva",
        meta: "em turno desde 08:26 · sem escala",
        group: "Entregas",
        blocks: [],
        actual: { start: 8.43, end: 20.75 },
        actualLabel: "sem escala · desde 08:26",
      },
      { id: "kelly", label: "Kelly Fontoura", group: "Cozinha", blocks: [] },
    ],
    now: 20.75,
    coverage: [0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 0, 0],
    coverageLabel: "Na escala, por hora",
    onCreate: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    onBlockClick: vi.fn(),
    labels: PT_BR_UI_LABELS.dayRuler,
    "aria-label": "Escala do dia",
    dataTestId: "dr",
    ...overrides,
  };
  render(<DayRuler {...props} />);
  return props;
}

const track = (rowId: string): HTMLElement => screen.getByTestId(`dr-track-${rowId}`);
const block = (id: string): HTMLElement => screen.getByTestId(`dr-block-${id}`);
const live = (): string => screen.getByTestId("dr-live").textContent ?? "";

function press(el: HTMLElement, hour: number, pointerType = "mouse"): void {
  fireEvent.pointerDown(el, { clientX: x(hour), pointerType, button: 0 });
}
function moveTo(hour: number, pointerType = "mouse"): void {
  fireEvent.pointerMove(window, { clientX: x(hour), pointerType, buttons: 1 });
}
function release(el: HTMLElement = document.body): void {
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

describe("the arithmetic", () => {
  it("snaps and clamps the hour under the pointer", async () => {
    expect(hourAt(147, 0, 200, 6, 26, 0.25)).toBe(20.75);
    expect(hourAt(-50, 0, 200, 6, 26, 0.25)).toBe(6);
    expect(hourAt(999, 0, 200, 6, 26, 0.25)).toBe(26);
  });

  it("writes HH:MM past midnight", async () => {
    expect(formatHour(26)).toBe("02:00");
    expect(formatHour(24)).toBe("00:00");
    expect(formatHour(20.65)).toBe("20:39");
    expect(formatRange(20.75, 24.75)).toBe("20:45–00:45");
  });

  it("moves inside the ruler, resizes never under 30 minutes, and a click alone is createHours", async () => {
    expect(moved(22, 26, 1, 6, 26)).toEqual([22, 26]);
    expect(moved(8, 12, -5, 6, 26)).toEqual([6, 10]);
    expect(resized(8, 12, "end", 7, 0.5, 6, 26)).toEqual([8, 8.5]);
    expect(resized(8, 12, "start", 13, 0.5, 6, 26)).toEqual([11.5, 12]);
    expect(createdSpan(10, 10.25, 0.5, 4, 26)).toEqual([10, 14]);
    expect(createdSpan(24, 24, 0.5, 4, 26)).toEqual([24, 26]);
    expect(createdSpan(12, 9, 0.5, 4, 26)).toEqual([9, 12]);
    expect(percentOf(16, 6, 26)).toBe(50);
    expect(ticksOf(6, 26, 4)).toEqual([6, 10, 14, 18, 22, 26]);
  });
});

describe("what it draws", () => {
  it("the coverage counts, the axis 06:00 → 02:00, groups, names, meta and actions", async () => {
    renderRuler();
    const cov = screen.getByTestId("dr-coverage");
    expect(cov).toHaveTextContent("Na escala, por hora");
    expect(within(cov).getAllByText("5")).toHaveLength(13);
    expect(screen.getByTestId("dr-axis")).toHaveTextContent("06:0010:0014:0018:0022:0002:00");
    expect(screen.getByRole("list", { name: "Entregas" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Cozinha" })).toBeInTheDocument();
    expect(screen.getByText("atrasado · era 20:39")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar agora" })).toBeInTheDocument();
  });

  it("places blocks, the actual bar and the now line by hour", async () => {
    renderRuler();
    expect(block("b1").style.left || getComputedStyle(block("b1")).left).toMatch(/73\.2\d*%/);
    const lines = screen.getAllByTestId("dr-now");
    expect(lines).toHaveLength(3);
    expect(getComputedStyle(lines[0]!).left).toBe("73.75%");
    expect(screen.getByTestId("dr-actual-ana")).toBeInTheDocument();
    expect(screen.getByText("sem escala · desde 08:26")).toBeInTheDocument();
  });

  it("hides the now line off the ruler", async () => {
    renderRuler({ now: 3 });
    await waitFor(() => expect(screen.queryByTestId("dr-now")).toBeNull());
  });
});

describe("create", () => {
  it("a drag on an empty track creates from the pressed hour to the pointer, snapped", async () => {
    const props = renderRuler();
    press(track("kelly"), 10.1);
    moveTo(14.4);
    expect(screen.getByTestId("dr-preview")).toHaveTextContent("10:00–14:30");
    release();
    expect(props.onCreate).toHaveBeenCalledWith("kelly", 10, 14.5);
  });

  it("a click alone creates createHours, kept on the ruler", async () => {
    const props = renderRuler();
    press(track("kelly"), 12);
    release();
    press(track("kelly"), 24);
    release();
    expect(props.onCreate).toHaveBeenNthCalledWith(1, "kelly", 12, 16);
    expect(props.onCreate).toHaveBeenNthCalledWith(2, "kelly", 24, 26);
  });

  it("a press on a block is not a create", async () => {
    const props = renderRuler();
    press(block("b1"), 22);
    release(block("b1"));
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onBlockClick).toHaveBeenCalledWith("b1");
  });
});

describe("move and resize", () => {
  it("dragging the middle slides the block, keeping its length", async () => {
    const props = renderRuler();
    press(block("b1"), 22);
    moveTo(21);
    expect(block("b1")).toHaveTextContent("19:39–23:00");
    release();
    expect(props.onMove).toHaveBeenCalledWith("b1", 19.65, 23);
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("clamps a move at the ruler's end", async () => {
    const props = renderRuler();
    press(block("b1"), 22);
    moveTo(30);
    release();
    expect(props.onMove).toHaveBeenCalledWith("b1", 22.65, 26);
  });

  it("dragging an end handle changes that end, never under 30 minutes", async () => {
    const props = renderRuler();
    press(screen.getByTestId("dr-handle-r-b1"), 24);
    moveTo(25.1);
    release();
    expect(props.onResize).toHaveBeenLastCalledWith("b1", 20.65, 25);
    press(screen.getByTestId("dr-handle-l-b1"), 20.75);
    moveTo(23.9);
    release();
    expect(props.onResize).toHaveBeenLastCalledWith("b1", 23.5, 24);
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("a handle pressed in place changes nothing and opens nothing", async () => {
    const props = renderRuler();
    press(screen.getByTestId("dr-handle-r-b1"), 24);
    release(screen.getByTestId("dr-handle-r-b1"));
    expect(props.onResize).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });
});

describe("after a drag, and abandoning one", () => {
  const rows: DayRulerProps["rows"] = [
    { id: "kelly", label: "Kelly Fontoura", blocks: [] },
    { id: "dina", label: "Dina Prado", blocks: [{ id: "e1", start: 8, end: 12, label: "Em turno", tone: "onduty" }] },
    { id: "luiz", label: "Luiz", blocks: [{ id: "b1", start: 20, end: 24, label: "20:00–00:00", tone: "plan", movable: true, resizable: true }] },
  ];
  const realClick = (el: HTMLElement): void => {
    fireEvent.pointerDown(el, { pointerType: "mouse", button: 0, clientX: x(10) });
    fireEvent.pointerUp(el);
    fireEvent.click(el);
  };

  it("a drag-create does not eat the next click on a block that cannot move", async () => {
    const props = renderRuler({ rows });
    press(track("kelly"), 10);
    moveTo(14);
    release(track("kelly"));
    expect(props.onCreate).toHaveBeenCalledWith("kelly", 10, 14);
    realClick(block("e1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("e1");
  });

  it("the click left behind dies with the task after the release", async () => {
    const props = renderRuler({ rows });
    press(track("kelly"), 10);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      release(track("kelly"));
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(block("e1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("e1");
  });

  it("Escape drops a move: the block back at its hours, nothing reported, the release's click ignored", async () => {
    const props = renderRuler({ rows });
    const before = block("b1").style.left || getComputedStyle(block("b1")).left;
    press(block("b1"), 22);
    moveTo(18);
    expect(block("b1")).toHaveTextContent("16:00–20:00");
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(block("b1")).toHaveTextContent("20:00–00:00");
    expect(getComputedStyle(block("b1")).left).toBe(before);
    release(block("b1"));
    expect(props.onMove).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("Escape drops a create: the preview gone, nothing created", async () => {
    const props = renderRuler({ rows });
    press(track("kelly"), 10);
    moveTo(14);
    expect(screen.getByTestId("dr-preview")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dr-preview")).toBeNull());
    release(track("kelly"));
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("the window losing focus drops a resize", async () => {
    const props = renderRuler({ rows });
    press(screen.getByTestId("dr-handle-r-b1"), 24);
    moveTo(25);
    fireEvent.blur(window);
    expect(block("b1")).toHaveTextContent("20:00–00:00");
    release();
    expect(props.onResize).not.toHaveBeenCalled();
  });

  it("a move with no button down drops it, and the next press works", async () => {
    const props = renderRuler({ rows });
    press(block("b1"), 22);
    moveTo(18);
    fireEvent.pointerMove(window, { clientX: x(17), pointerType: "mouse", buttons: 0 });
    expect(block("b1")).toHaveTextContent("20:00–00:00");
    fireEvent.pointerUp(document.body);
    expect(props.onMove).not.toHaveBeenCalled();
    realClick(block("e1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("e1");
  });

  it("a release outside the ruler still commits", async () => {
    const props = renderRuler({ rows });
    press(block("b1"), 22);
    moveTo(21);
    fireEvent.pointerUp(document.body);
    expect(props.onMove).toHaveBeenCalledWith("b1", 19, 23);
  });
});

describe("touch", () => {
  it("never drags or creates; a tap on a block opens it", async () => {
    const props = renderRuler();
    press(track("kelly"), 10, "touch");
    moveTo(14, "touch");
    fireEvent.pointerUp(document.body);
    press(block("b1"), 22, "touch");
    moveTo(18, "touch");
    fireEvent.pointerUp(document.body);
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    fireEvent.click(block("b1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("b1");
  });
});

describe("read-only", () => {
  it("creates, moves and resizes nothing; a block still opens", async () => {
    const props = renderRuler({ readOnly: true });
    press(track("kelly"), 10);
    release();
    press(block("b1"), 22);
    moveTo(18);
    release(block("b1"));
    await waitFor(() => expect(screen.queryByTestId("dr-handle-r-b1")).toBeNull());
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    fireEvent.click(block("b1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("b1");
    expect(track("kelly")).not.toHaveAttribute("tabindex");
  });
});

describe("keyboard", () => {
  it("Enter on a focused track creates createHours from now, snapped up", async () => {
    const props = renderRuler();
    expect(track("kelly")).toHaveAttribute("aria-label", "Agendar Kelly Fontoura");
    fireEvent.keyDown(track("kelly"), { key: "Enter" });
    expect(props.onCreate).toHaveBeenCalledWith("kelly", 20.75, 24.75);
  });

  it("Enter uses the host's createStart when given", async () => {
    const props = renderRuler({ createStart: () => 17 });
    fireEvent.keyDown(track("kelly"), { key: "Enter" });
    expect(props.onCreate).toHaveBeenCalledWith("kelly", 17, 21);
  });

  it("Alt+→ moves a block by one snap and says so", async () => {
    const props = renderRuler();
    fireEvent.keyDown(block("b1"), { key: "ArrowRight", altKey: true });
    expect(props.onMove).toHaveBeenCalledWith("b1", 20.9, 24.25);
    await waitFor(() => expect(live()).toBe("↻ 20:39–00:00 agora 20:54–00:15"));
  });

  it("Shift+← moves the end and Shift+Alt+→ the start", async () => {
    const props = renderRuler();
    fireEvent.keyDown(block("b1"), { key: "ArrowLeft", shiftKey: true });
    expect(props.onResize).toHaveBeenLastCalledWith("b1", 20.65, 23.75);
    fireEvent.keyDown(block("b1"), { key: "ArrowRight", shiftKey: true, altKey: true });
    expect(props.onResize).toHaveBeenLastCalledWith("b1", 20.9, 24);
  });

  it("past the ruler's end is refused aloud", async () => {
    const props = renderRuler({
      rows: [{ id: "z", label: "Z", blocks: [{ id: "z1", start: 22, end: 26, label: "22:00–02:00", tone: "plan", movable: true }] }],
    });
    fireEvent.keyDown(block("z1"), { key: "ArrowRight", altKey: true });
    expect(props.onMove).not.toHaveBeenCalled();
    await waitFor(() => expect(live()).toBe("Não dá para ir além"));
  });

  it("Shift or Alt+arrow on a block that cannot move or resize says the block is fixed, and goes no further", async () => {
    const props = renderRuler({
      rows: [{ id: "d", label: "Dina", blocks: [{ id: "e1", start: 8, end: 12, label: "Em turno", tone: "onduty" }] }],
    });
    expect(fireEvent.keyDown(block("e1"), { key: "ArrowLeft", altKey: true })).toBe(false);
    await waitFor(() => expect(live()).toBe("Este turno não muda por aqui"));
    expect(fireEvent.keyDown(block("e1"), { key: "ArrowRight", shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(block("e1"), { key: "ArrowRight" })).toBe(true);
    expect(props.onMove).not.toHaveBeenCalled();
    expect(props.onResize).not.toHaveBeenCalled();
  });

  it("the same sentence twice is read twice, from one region that stays mounted", async () => {
    renderRuler({
      rows: [{ id: "z", label: "Z", blocks: [{ id: "z1", start: 22, end: 26, label: "22:00–02:00", tone: "plan", movable: true }] }],
    });
    const region = screen.getByTestId("dr-live");
    fireEvent.keyDown(block("z1"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(live()).toBe("Não dá para ir além"));
    fireEvent.keyDown(block("z1"), { key: "ArrowRight", altKey: true });
    expect(region.textContent).toBe("");
    await waitFor(() => expect(live()).toBe("Não dá para ir além"));
    expect(screen.getByTestId("dr-live")).toBe(region);
  });

  it("Enter on a block is its click (it is a button)", async () => {
    renderRuler();
    expect(block("b1").tagName).toBe("BUTTON");
  });
});

describe("states", () => {
  it("loading: skeleton rows, busy, nothing to press", async () => {
    renderRuler({ loading: true });
    expect(screen.getByRole("region", { name: "Escala do dia" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("dr-loading")).toHaveLength(4);
    await waitFor(() => expect(screen.queryByTestId("dr-block-b1")).toBeNull());
  });

  it("error and empty are the host's nodes", async () => {
    renderRuler({ error: <p>Não foi possível carregar</p> });
    expect(screen.getByText("Não foi possível carregar")).toBeInTheDocument();
    cleanup();
    renderRuler({ rows: [], empty: <p>Ninguém na escala neste dia.</p> });
    expect(screen.getByText("Ninguém na escala neste dia.")).toBeInTheDocument();
  });

  it("falls back to the English pack", async () => {
    renderRuler({ labels: undefined });
    expect(track("kelly")).toHaveAttribute("aria-label", "Schedule Kelly Fontoura");
  });
});

describe("selection", () => {
  it("rings the selected block and marks it current, not pressed", async () => {
    renderRuler({ rows: [{ id: "a", label: "Ana", blocks: [{ id: "s1", start: 8, end: 12, label: "08:00–12:00", tone: "plan", selected: true }] }] });
    expect(block("s1")).toHaveAttribute("aria-current", "true");
    expect(block("s1")).not.toHaveAttribute("aria-pressed");
    expect(getComputedStyle(block("s1")).boxShadow).toMatch(/^0 0 0 /);
  });
});

describe("the slots a later story fills (FUT-3881)", () => {
  const rows: DayRulerProps["rows"] = [
    {
      id: "bruno",
      label: "Bruno Lima",
      nameAdornment: <span>Freela</span>,
      blocks: [{ id: "p1", start: 11, end: 19, label: "11:00–19:00", tone: "plan", movable: true, resizable: true, breakSpan: { start: 14, end: 15 } }],
    },
  ];
  const band = (): HTMLElement => screen.getByTestId("dr-break-p1");

  it("draws the break inside its block at its hours, hidden from the accessibility tree", async () => {
    renderRuler({ rows });
    expect(block("p1")).toContainElement(band());
    expect(band()).toHaveAttribute("aria-hidden", "true");
    expect(getComputedStyle(band()).left).toBe("37.5%");
    expect(getComputedStyle(band()).width).toBe("12.5%");
  });

  it("carries the break with a block being moved, and keeps it at its hours while an end is dragged", async () => {
    renderRuler({ rows });
    press(block("p1"), 12);
    moveTo(14);
    expect(block("p1")).toHaveTextContent("13:00–21:00");
    expect(getComputedStyle(band()).left).toBe("37.5%");
    release();
    cleanup();
    renderRuler({ rows });
    press(screen.getByTestId("dr-handle-l-p1"), 11);
    moveTo(15);
    expect(block("p1")).toHaveTextContent("15:00–19:00");
    await waitFor(() => expect(screen.queryByTestId("dr-break-p1")).toBeNull());
    moveTo(13);
    expect(getComputedStyle(band()).left).toMatch(/^16\.66\d*%$/);
    release();
  });

  it("puts the name's adornment beside the name", async () => {
    renderRuler({ rows });
    expect(within(screen.getByTestId("dr-row-bruno")).getByText("Freela")).toBeInTheDocument();
    expect(screen.getByTestId("dr-row-bruno")).toHaveTextContent(/^Bruno LimaFreela/);
  });
});
