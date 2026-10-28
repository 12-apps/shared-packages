/**
 * ScheduleGrid driven through the DOM (FUT-3825): click and drag to create,
 * edge-copy, move, block click, blocked cells, read-only, touch, the keyboard
 * twins with their live region, and the loading / error / empty states.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_UI_LABELS } from "../../../../pt-BR.labels";
import { ScheduleGrid } from "../ScheduleGrid";
import type { ScheduleGridCell, ScheduleGridProps } from "../ScheduleGrid.types";

const COLUMNS = ["Seg 19/10", "Ter 20/10", "Qua 21/10", "Qui 22/10", "Sex 23/10", "Sáb 24/10", "Dom 25/10"].map(
  (label, index) => ({ label, sublabel: index === 0 ? "1 turno" : "ninguém", today: index === 0 }),
);

/** Ana: a weekly turno on Wednesday; Bia: on leave Tue–Thu; Caio: nothing. */
const CELLS: Record<string, ScheduleGridCell> = {
  "ana:2": { blocks: [{ id: "k1", label: "11:00–15:00", note: "↻ toda semana", tone: "plan", movable: true, copyable: true }] },
  "ana:4": { blocks: [{ id: "k2", label: "08:00–14:00", tone: "plan", movable: true, copyable: true }] },
  "bia:0": { blocks: [{ id: "u1", label: "21:00–23:30", note: "Sem ninguém", tone: "uncovered", movable: true }] },
  "bia:1": { blocks: [], blocked: true, blockedLabel: "Afastamento" },
  "bia:2": { blocks: [], blocked: true },
  "bia:3": { blocks: [], blocked: true },
  "caio:0": { blocks: [{ id: "d1", label: "Em turno", note: "desde 08:26", tone: "onduty" }] },
};
const EMPTY: ScheduleGridCell = { blocks: [] };
const cell = (rowId: string, day: number): ScheduleGridCell => CELLS[`${rowId}:${day}`] ?? EMPTY;

function renderGrid(overrides: Partial<ScheduleGridProps> = {}) {
  const props: ScheduleGridProps = {
    columns: COLUMNS,
    groups: [
      {
        title: "Entregas",
        rows: [
          { id: "ana", label: "Ana Lima", total: "8h" },
          { id: "bia", label: "Bia Souza", meta: "Afastamento · licença", total: "2h30" },
          { id: "caio", label: "Caio Nunes", meta: "70h na semana · acima de 40h", metaTone: "warning" },
        ],
      },
    ],
    cell,
    totalLabel: "horas",
    onCreate: vi.fn(),
    onCopy: vi.fn(),
    onMove: vi.fn(),
    onBlockClick: vi.fn(),
    createPreview: () => "08:00–14:00",
    labels: PT_BR_UI_LABELS.scheduleGrid,
    "aria-label": "Escala da semana",
    dataTestId: "sg",
    ...overrides,
  };
  const view = render(<ScheduleGrid {...props} />);
  const rerender = (next: Partial<ScheduleGridProps>): void => view.rerender(<ScheduleGrid {...props} {...next} />);
  return { props, rerender };
}

const cellEl = (rowId: string, day: number): HTMLElement => screen.getByTestId(`sg-cell-${rowId}-${day}`);
const plusOf = (rowId: string, day: number): HTMLElement => within(cellEl(rowId, day)).getByRole("button");
const block = (id: string): HTMLElement => screen.getByTestId(`sg-block-${id}`);
const live = (): string => screen.getByTestId("sg-live").textContent ?? "";

/** A mouse press on `from`, moves over each of `over`, release on the last. */
function drag(from: HTMLElement, over: HTMLElement[], pointerType = "mouse"): void {
  fireEvent.pointerDown(from, { pointerType, button: 0 });
  for (const target of over) fireEvent.pointerMove(target, { pointerType, buttons: 1 });
  fireEvent.pointerUp(over[over.length - 1] ?? from, { pointerType });
  fireEvent.click(over[over.length - 1] ?? from);
}

afterEach(cleanup);

// jsdom has no PointerEvent: without one, `pointerType` never reaches the handler.
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

describe("what it draws", () => {
  it("names the grid and draws each column, group, name, meta and total", async () => {
    renderGrid();
    const table = screen.getByRole("table", { name: "Escala da semana" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    expect(screen.getByText("Seg 19/10")).toBeInTheDocument();
    expect(screen.getByText("horas")).toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Entregas" })).toBeInTheDocument();
    expect(screen.getByText("Afastamento · licença")).toBeInTheDocument();
    expect(screen.getByText("2h30")).toBeInTheDocument();
  });

  it("carries each tone's note as text, never colour alone", async () => {
    renderGrid();
    expect(block("k1")).toHaveTextContent("11:00–15:00↻ toda semana");
    expect(block("u1")).toHaveTextContent("Sem ninguém");
    expect(block("d1")).toHaveAttribute("data-tone", "onduty");
    expect(block("k1")).toHaveAttribute("title", "11:00–15:00 · ↻ toda semana");
  });

  it("offers a named '+' on an empty cell only, never on a blocked or a full one", async () => {
    renderGrid();
    expect(screen.getByRole("button", { name: "Agendar Caio Nunes, Ter 20/10" })).toBeInTheDocument();
    await waitFor(() => expect(within(cellEl("bia", 1)).queryByRole("button")).toBeNull());
    expect(within(cellEl("ana", 2)).getAllByRole("button")).toHaveLength(1);
    expect(cellEl("bia", 1)).toHaveTextContent("Afastamento");
    expect(cellEl("bia", 2)).toHaveAttribute("aria-label", "Bia Souza, Qua 21/10: fechado");
  });

  it("shows grips on copyable blocks only", async () => {
    renderGrid();
    expect(screen.getByTestId("sg-grip-l-k1")).toBeInTheDocument();
    expect(screen.getByTestId("sg-grip-r-k1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("sg-grip-l-u1")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("sg-grip-l-d1")).toBeNull());
  });

  it("makes the name a button when the host acts on it", async () => {
    const onLabelClick = vi.fn();
    renderGrid({
      groups: [{ rows: [{ id: "ana", label: "Ana Lima", onLabelClick, labelAccessible: "Ana Lima: horas e afastamento" }] }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Ana Lima: horas e afastamento" }));
    expect(onLabelClick).toHaveBeenCalledTimes(1);
  });
});

describe("create", () => {
  it("a click on an empty cell creates one day", async () => {
    const { props } = renderGrid();
    fireEvent.click(plusOf("caio", 3));
    expect(props.onCreate).toHaveBeenCalledWith("caio", [3]);
  });

  it("a press and release in place is that click, once", async () => {
    const { props } = renderGrid();
    drag(plusOf("caio", 3), []);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate).toHaveBeenCalledWith("caio", [3]);
  });

  it("a drag across a row creates on every crossed day that is empty, skipping a taken one", async () => {
    const { props } = renderGrid();
    drag(plusOf("ana", 1), [cellEl("ana", 2), cellEl("ana", 3), cellEl("ana", 5)]);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate).toHaveBeenCalledWith("ana", [1, 3, 5]);
  });

  it("stays on its row when the pointer strays to another one", async () => {
    const { props } = renderGrid();
    drag(plusOf("caio", 1), [cellEl("ana", 3)]);
    expect(props.onCreate).toHaveBeenCalledWith("caio", [1, 2, 3]);
  });

  it("never lands on a blocked day", async () => {
    const { props } = renderGrid();
    drag(plusOf("bia", 4), [cellEl("bia", 3), cellEl("bia", 1)]);
    expect(props.onCreate).toHaveBeenCalledWith("bia", [4]);
  });

  it("draws the covered cells dashed with the hours as ghost text while dragging", async () => {
    renderGrid();
    fireEvent.pointerDown(plusOf("caio", 1), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 3), { pointerType: "mouse", buttons: 1 });
    expect(cellEl("caio", 2)).toHaveTextContent("08:00–14:00");
    expect(cellEl("caio", 3)).toHaveTextContent("08:00–14:00");
    expect(cellEl("caio", 4)).not.toHaveTextContent("08:00–14:00");
    fireEvent.pointerUp(cellEl("caio", 3));
    expect(cellEl("caio", 2)).not.toHaveTextContent("08:00–14:00");
  });

  it("a cancelled pointer (the page scrolled) creates nothing", async () => {
    const { props } = renderGrid();
    fireEvent.pointerDown(plusOf("caio", 1), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 3), { pointerType: "mouse", buttons: 1 });
    fireEvent.pointerCancel(cellEl("caio", 3));
    fireEvent.pointerUp(cellEl("caio", 3));
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

describe("copy by the edge grip", () => {
  it("copies along the row to the crossed days, never its own or a taken one", async () => {
    const { props } = renderGrid();
    drag(screen.getByTestId("sg-grip-r-k1"), [cellEl("ana", 3), cellEl("ana", 4), cellEl("ana", 5)]);
    expect(props.onCopy).toHaveBeenCalledWith("k1", [3, 5]);
    expect(props.onBlockClick).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("copies backwards with the left grip", async () => {
    const { props } = renderGrid();
    drag(screen.getByTestId("sg-grip-l-k1"), [cellEl("ana", 1), cellEl("ana", 0)]);
    expect(props.onCopy).toHaveBeenCalledWith("k1", [0, 1]);
  });

  it("a grip pressed in place copies nothing and does not open the block", async () => {
    const { props } = renderGrid();
    drag(screen.getByTestId("sg-grip-r-k1"), []);
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("shows the block's hours as ghost text in the target cells", async () => {
    renderGrid();
    fireEvent.pointerDown(screen.getByTestId("sg-grip-r-k1"), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("ana", 3), { pointerType: "mouse", buttons: 1 });
    expect(cellEl("ana", 3)).toHaveTextContent("11:00–15:00");
    fireEvent.pointerUp(cellEl("ana", 3));
  });
});

describe("move by the middle", () => {
  it("moves to an empty cell of any row", async () => {
    const { props } = renderGrid();
    drag(block("k1"), [cellEl("caio", 5)]);
    expect(props.onMove).toHaveBeenCalledWith("k1", "caio", 5);
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("refuses a taken cell, a blocked one and its own", async () => {
    const { props } = renderGrid();
    drag(block("k1"), [cellEl("ana", 4)]);
    drag(block("k1"), [cellEl("bia", 2)]);
    drag(block("k1"), [cellEl("ana", 3), cellEl("ana", 2)]);
    expect(props.onMove).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("highlights the cell under the pointer", async () => {
    renderGrid();
    fireEvent.pointerDown(block("k1"), { pointerType: "mouse", button: 0 });
    const before = getComputedStyle(cellEl("caio", 5)).borderColor;
    fireEvent.pointerMove(cellEl("caio", 5), { pointerType: "mouse", buttons: 1 });
    expect(getComputedStyle(cellEl("caio", 5)).borderColor).not.toBe(before);
    fireEvent.pointerUp(cellEl("caio", 5));
  });

  it("a block that is not movable does not move", async () => {
    const { props } = renderGrid();
    drag(block("d1"), [cellEl("caio", 4)]);
    expect(props.onMove).not.toHaveBeenCalled();
  });
});

describe("click a block", () => {
  it("reports every tone's click", async () => {
    const { props } = renderGrid();
    fireEvent.click(block("k1"));
    fireEvent.click(block("u1"));
    fireEvent.click(block("d1"));
    expect(props.onBlockClick).toHaveBeenNthCalledWith(1, "k1");
    expect(props.onBlockClick).toHaveBeenNthCalledWith(2, "u1");
    expect(props.onBlockClick).toHaveBeenNthCalledWith(3, "d1");
  });

  it("a press and release in place on a block is its click", async () => {
    const { props } = renderGrid();
    drag(block("k1"), []);
    expect(props.onBlockClick).toHaveBeenCalledWith("k1");
  });
});

describe("after a drag", () => {
  /** A real click: the press and the release reach the window before the click does. */
  const realClick = (el: HTMLElement): void => {
    fireEvent.pointerDown(el, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(el, { pointerType: "mouse" });
    fireEvent.click(el);
  };

  it("a drag-create does not eat the next click on a block that cannot move", async () => {
    const { props } = renderGrid();
    drag(plusOf("caio", 1), [cellEl("caio", 2), cellEl("caio", 3)]);
    expect(props.onCreate).toHaveBeenCalledWith("caio", [1, 2, 3]);
    realClick(block("d1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("d1");
  });

  it("the click left behind dies with the task after the release, even without a new press", async () => {
    const { props } = renderGrid();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      drag(plusOf("caio", 1), [cellEl("caio", 3)]);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(block("d1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("d1");
  });

  it("still swallows the click the release itself leaves on the moved block", async () => {
    const { props } = renderGrid();
    fireEvent.pointerDown(block("k1"), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 5), { pointerType: "mouse", buttons: 1 });
    fireEvent.pointerUp(cellEl("caio", 5), { pointerType: "mouse" });
    fireEvent.click(block("k1"));
    expect(props.onMove).toHaveBeenCalledWith("k1", "caio", 5);
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });
});

describe("abandoning a drag", () => {
  const startCreate = (): void => {
    fireEvent.pointerDown(plusOf("caio", 1), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 3), { pointerType: "mouse", buttons: 1 });
    expect(cellEl("caio", 3)).toHaveTextContent("08:00–14:00");
  };

  it("Escape drops it: nothing created, the ghost gone, the release's click ignored", async () => {
    const { props } = renderGrid();
    startCreate();
    const escape = fireEvent.keyDown(window, { key: "Escape" });
    expect(escape).toBe(false);
    expect(cellEl("caio", 3)).not.toHaveTextContent("08:00–14:00");
    fireEvent.pointerUp(cellEl("caio", 3), { pointerType: "mouse" });
    fireEvent.click(plusOf("caio", 3));
    expect(props.onCreate).not.toHaveBeenCalled();
    fireEvent.click(plusOf("caio", 4));
    expect(props.onCreate).toHaveBeenCalledWith("caio", [4]);
  });

  it("Escape drops a move: the block stays and its trailing click does not open it", async () => {
    const { props } = renderGrid();
    fireEvent.pointerDown(block("k1"), { pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 5), { pointerType: "mouse", buttons: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(cellEl("caio", 5), { pointerType: "mouse" });
    fireEvent.click(block("k1"));
    expect(props.onMove).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
  });

  it("the window losing focus drops it", async () => {
    const { props } = renderGrid();
    startCreate();
    fireEvent.blur(window);
    expect(cellEl("caio", 3)).not.toHaveTextContent("08:00–14:00");
    fireEvent.pointerUp(cellEl("caio", 3), { pointerType: "mouse" });
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("a move with no button down (released outside the page) drops it", async () => {
    const { props } = renderGrid();
    startCreate();
    fireEvent.pointerMove(cellEl("caio", 4), { pointerType: "mouse", buttons: 0 });
    expect(cellEl("caio", 3)).not.toHaveTextContent("08:00–14:00");
    expect(cellEl("caio", 4)).not.toHaveTextContent("08:00–14:00");
    fireEvent.pointerUp(cellEl("caio", 4), { pointerType: "mouse" });
    expect(props.onCreate).not.toHaveBeenCalled();
    fireEvent.click(plusOf("caio", 4));
    expect(props.onCreate).toHaveBeenCalledWith("caio", [4]);
  });

  it("other keys leave it running, and a release outside the grid still commits", async () => {
    const { props } = renderGrid();
    startCreate();
    expect(fireEvent.keyDown(window, { key: "a" })).toBe(true);
    fireEvent.pointerUp(document.body, { pointerType: "mouse" });
    expect(props.onCreate).toHaveBeenCalledWith("caio", [1, 2, 3]);
  });

  it("Escape with no drag running is left to the page", async () => {
    renderGrid();
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
  });
});

describe("touch", () => {
  it("never drags: a swipe across cells creates nothing, a tap still creates", async () => {
    const { props } = renderGrid();
    fireEvent.pointerDown(plusOf("caio", 1), { pointerType: "touch", button: 0 });
    fireEvent.pointerMove(cellEl("caio", 3), { pointerType: "touch", buttons: 1 });
    fireEvent.pointerUp(cellEl("caio", 3), { pointerType: "touch" });
    expect(props.onCreate).not.toHaveBeenCalled();
    fireEvent.click(plusOf("caio", 1));
    expect(props.onCreate).toHaveBeenCalledWith("caio", [1]);
  });

  it("never moves a block", async () => {
    const { props } = renderGrid();
    drag(block("k1"), [cellEl("caio", 5)], "touch");
    expect(props.onMove).not.toHaveBeenCalled();
  });
});

describe("read-only", () => {
  it("has no '+', no grips and no drag; a block still opens", async () => {
    const { props } = renderGrid({ readOnly: true });
    await waitFor(() => expect(within(cellEl("caio", 3)).queryByRole("button")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("sg-grip-r-k1")).toBeNull());
    drag(block("k1"), [cellEl("caio", 5)]);
    expect(props.onMove).not.toHaveBeenCalled();
    expect(props.onBlockClick).not.toHaveBeenCalled();
    fireEvent.click(block("k1"));
    expect(props.onBlockClick).toHaveBeenCalledWith("k1");
  });

  it("without onCreate an empty cell is not a button", async () => {
    renderGrid({ onCreate: undefined });
    await waitFor(() => expect(within(cellEl("caio", 3)).queryByRole("button")).toBeNull());
  });
});

describe("keyboard", () => {
  it("Shift+→ copies a block one day and says so", async () => {
    const { props } = renderGrid();
    fireEvent.keyDown(block("k1"), { key: "ArrowRight", shiftKey: true });
    expect(props.onCopy).toHaveBeenCalledWith("k1", [3]);
    await waitFor(() => expect(live()).toBe("11:00–15:00 copiado para Qui 22/10"));
  });

  it("Shift+← into a blocked or taken day is refused aloud", async () => {
    const { props } = renderGrid();
    fireEvent.keyDown(block("k2"), { key: "ArrowRight", shiftKey: true });
    expect(props.onCopy).toHaveBeenCalledWith("k2", [5]);
    fireEvent.keyDown(block("u1"), { key: "ArrowRight", altKey: true });
    expect(props.onMove).not.toHaveBeenCalled();
    await waitFor(() => expect(live()).toBe("Não dá para pôr aí: o dia está ocupado ou fechado"));
  });

  it("Alt+← moves a block one day, says so, and focus follows it", async () => {
    const { props, rerender } = renderGrid();
    fireEvent.keyDown(block("k1"), { key: "ArrowLeft", altKey: true });
    expect(props.onMove).toHaveBeenCalledWith("k1", "ana", 1);
    await waitFor(() => expect(live()).toBe("11:00–15:00 movido para Ana Lima, Ter 20/10"));
    const after = (row: string, day: number): ScheduleGridCell => {
      if (row === "ana" && day === 1) return cell("ana", 2);
      if (row === "ana" && day === 2) return EMPTY;
      return cell(row, day);
    };
    rerender({ cell: after });
    expect(cellEl("ana", 1)).toContainElement(block("k1"));
    await waitFor(() => expect(block("k1")).toHaveFocus());
  });

  it("past the last day is refused", async () => {
    const { props } = renderGrid({
      cell: (row, day) => (row === "caio" && day === 6 ? { blocks: [{ id: "z", label: "x", tone: "plan", copyable: true }] } : EMPTY),
    });
    fireEvent.keyDown(block("z"), { key: "ArrowRight", shiftKey: true });
    expect(props.onCopy).not.toHaveBeenCalled();
    await waitFor(() => expect(live()).toBe("Não dá para pôr aí: o dia está ocupado ou fechado"));
  });

  it("Shift or Alt+arrow on a block that cannot copy or move says the block is fixed, and goes no further", async () => {
    const { props } = renderGrid();
    const shift = fireEvent.keyDown(block("d1"), { key: "ArrowRight", shiftKey: true });
    expect(shift).toBe(false);
    await waitFor(() => expect(live()).toBe("Este turno não muda por aqui"));
    const alt = fireEvent.keyDown(block("d1"), { key: "ArrowLeft", altKey: true });
    expect(alt).toBe(false);
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("with Ctrl or Meta, Shift/Alt+arrow on a block is not the grid's key", async () => {
    const { props } = renderGrid();
    expect(fireEvent.keyDown(block("k1"), { key: "ArrowRight", shiftKey: true, ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(block("k1"), { key: "ArrowLeft", altKey: true, metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(block("k1"), { key: "ArrowLeft", altKey: true, shiftKey: true })).toBe(true);
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(block("k1"), { key: "ArrowRight", shiftKey: true });
    expect(props.onCopy).toHaveBeenCalledWith("k1", [3]);
  });

  it("the same sentence twice is read twice, from one region that stays mounted", async () => {
    renderGrid();
    const region = screen.getByTestId("sg-live");
    const refusedText = "Não dá para pôr aí: o dia está ocupado ou fechado";
    fireEvent.keyDown(block("u1"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(live()).toBe(refusedText));
    fireEvent.keyDown(block("u1"), { key: "ArrowRight", altKey: true });
    expect(region.textContent).toBe("");
    await waitFor(() => expect(live()).toBe(refusedText));
    expect(screen.getByTestId("sg-live")).toBe(region);
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("arrow keys move focus between cells, passing over a closed one", async () => {
    renderGrid();
    fireEvent.keyDown(plusOf("ana", 0), { key: "ArrowRight" });
    await waitFor(() => expect(plusOf("ana", 1)).toHaveFocus());
    fireEvent.keyDown(plusOf("ana", 1), { key: "ArrowRight" });
    await waitFor(() => expect(block("k1")).toHaveFocus());
    fireEvent.keyDown(block("k1"), { key: "ArrowDown" });
    await waitFor(() => expect(plusOf("caio", 2)).toHaveFocus());
    fireEvent.keyDown(plusOf("caio", 2), { key: "ArrowUp" });
    await waitFor(() => expect(block("k1")).toHaveFocus());
  });

  it("Enter on an empty cell creates (it is a button)", async () => {
    renderGrid();
    expect(plusOf("caio", 2).tagName).toBe("BUTTON");
    expect(block("k1").tagName).toBe("BUTTON");
  });
});

describe("states", () => {
  it("loading draws skeleton rows, busy, with nothing to press", async () => {
    const { props } = renderGrid({ loading: true });
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("sg-loading")).toHaveLength(4);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("error replaces the body with the host's node", async () => {
    renderGrid({ error: <p>Não foi possível carregar a escala</p> });
    expect(screen.getByText("Não foi possível carregar a escala")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("sg-row-ana")).toBeNull());
    expect(screen.getByText("Seg 19/10")).toBeInTheDocument();
  });

  it("no rows shows the host's empty node", async () => {
    renderGrid({ groups: [], empty: <p>Ninguém na equipe</p> });
    expect(screen.getByText("Ninguém na equipe")).toBeInTheDocument();
  });

  it("holds only rows directly inside the table: the error and the empty node sit in a row's cell", async () => {
    const { rerender } = renderGrid({ error: <p>Não foi possível carregar a escala</p> });
    const onlyRows = (): void => {
      const table = screen.getByRole("table");
      for (const child of Array.from(table.children)) expect(["row", "rowgroup"]).toContain(child.getAttribute("role"));
    };
    onlyRows();
    expect(screen.getByText("Não foi possível carregar a escala").closest('[role="cell"]')).not.toBeNull();
    rerender({ error: undefined, groups: [], empty: <p>Ninguém na equipe</p> });
    onlyRows();
    expect(screen.getByText("Ninguém na equipe").closest('[role="cell"]')).not.toBeNull();
  });

  it("gives every cell of the header row a role", async () => {
    renderGrid();
    for (const child of Array.from(screen.getByTestId("sg-header").children)) {
      expect(["cell", "columnheader"]).toContain(child.getAttribute("role"));
    }
  });

  it("falls back to the English pack without labels", async () => {
    renderGrid({ labels: undefined });
    expect(screen.getByRole("button", { name: "Schedule Caio Nunes, Ter 20/10" })).toBeInTheDocument();
  });
});

describe("selection and the sticky header", () => {
  it("rings the selected block and marks it current, not pressed", async () => {
    const selected: ScheduleGridCell = { blocks: [{ id: "s1", label: "08:00–14:00", tone: "plan", selected: true }] };
    renderGrid({ cell: (rowId, day) => (rowId === "caio" && day === 3 ? selected : cell(rowId, day)) });
    expect(block("s1")).toHaveAttribute("aria-current", "true");
    expect(block("s1")).not.toHaveAttribute("aria-pressed");
    expect(getComputedStyle(block("s1")).boxShadow).toMatch(/^0 0 0 /);
    expect(block("k1")).not.toHaveAttribute("aria-current");
  });

  it("pins the header row at stickyTop", async () => {
    renderGrid({ stickyTop: 64 });
    const header = screen.getByTestId("sg-header");
    expect(getComputedStyle(header).position).toBe("sticky");
    expect(getComputedStyle(header).top).toBe("4rem");
  });
});

describe("the slots a later story fills (FUT-3881)", () => {
  const withBreak: ScheduleGridCell = {
    blocks: [{ id: "p1", label: "11:00–19:00", note: "pausa 14:00–15:00", tone: "plan", breakSpan: { start: 0.375, end: 0.5 } }],
  };

  it("draws a block's break as a hatched band at its share of the block, out of the accessibility tree", async () => {
    renderGrid({ cell: (rowId, day) => (rowId === "ana" && day === 0 ? withBreak : cell(rowId, day)) });
    const band = screen.getByTestId("sg-break-p1");
    expect(block("p1")).toContainElement(band);
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(getComputedStyle(band).left).toBe("37.5%");
    expect(getComputedStyle(band).width).toBe("12.5%");
    expect(block("p1")).toHaveTextContent("11:00–19:00pausa 14:00–15:00");
  });

  it("keeps a break the host sent out of range inside the block, and draws none for an empty or a reversed one", async () => {
    const odd: ScheduleGridCell = {
      blocks: [
        { id: "o1", label: "a", tone: "plan", breakSpan: { start: -0.2, end: 1.4 } },
        { id: "o2", label: "b", tone: "plan", breakSpan: { start: 0.6, end: 0.6 } },
        { id: "o3", label: "c", tone: "plan", breakSpan: { start: 0.8, end: 0.2 } },
      ],
    };
    renderGrid({ cell: (rowId, day) => (rowId === "ana" && day === 0 ? odd : cell(rowId, day)) });
    expect(getComputedStyle(screen.getByTestId("sg-break-o1")).left).toBe("0%");
    expect(getComputedStyle(screen.getByTestId("sg-break-o1")).width).toBe("100%");
    await waitFor(() => expect(screen.queryByTestId("sg-break-o2")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("sg-break-o3")).toBeNull());
  });

  it("puts the name's adornment beside the name and the chips under the meta, both inside the row header", async () => {
    renderGrid({
      groups: [
        {
          title: "Entregas",
          rows: [
            {
              id: "ana",
              label: "Ana Lima",
              meta: "8h na semana",
              nameAdornment: <span>Freela</span>,
              chips: <button type="button">2 regras ›</button>,
              onLabelClick: vi.fn(),
            },
          ],
        },
      ],
    });
    const header = screen.getByRole("rowheader");
    expect(within(header).getByText("Freela")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Ana Lima" })).toBeInTheDocument();
    expect(header).toHaveTextContent("Ana LimaFreela8h na semana2 regras ›");
    expect(within(header).getByRole("button", { name: "2 regras ›" })).toBeInTheDocument();
  });
});
