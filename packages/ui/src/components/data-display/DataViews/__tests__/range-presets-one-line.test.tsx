/**
 * A range's presets sit on ONE line at every width (ADR 0190 in the host,
 * FUT-4144 UI review).
 *
 * Hoje · Ontem · Esta semana · Este mês · Este ano are the options of one
 * question. As wrapping chips they dropped "Este ano" onto a second line at
 * 320, 390 and 600, which reads as a second question. Where the row is wide
 * enough they are a segmented control of equal parts; where it is not, the same
 * question is a select — same options, same order, same "pick the active one
 * again to clear".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

import { TableFilterContext } from "../../../layout/TableFilter/TableFilterContext";
import { PT_BR_TABLE_FILTER_COPY } from "../../../../pt-BR.layout";
import { RangePresets, presetsFitOneLine } from "../data-views-preset-chips";
import { PanelRangeField } from "../data-views-range-pill";
import type { RangeFieldConfig, RangePreset, RangeValue } from "../data-views-types";
import { fireEvent, render, screen, within } from "./test-utils";

const PRESETS: RangePreset[] = [
  { id: "hoje", label: "Hoje", range: { min: "2026-10-28", max: "2026-10-28" } },
  { id: "ontem", label: "Ontem", range: { min: "2026-10-27", max: "2026-10-27" } },
  { id: "semana", label: "Esta semana", range: { min: "2026-10-25", max: "2026-10-31" } },
  { id: "mes", label: "Este mês", range: { min: "2026-10-01", max: "2026-10-31" } },
  { id: "ano", label: "Este ano", range: { min: "2026-01-01", max: "2026-12-31" } },
];

/** The widest label ("Esta semana") with its padding, as Chromium lays it out. */
const NATURAL = 96;

/** Valor's labels with their padding and border, as Chromium lays them out at 12px/600. */
const MEASURED: Readonly<Record<string, number>> = { "Até R$ 5": 68, "R$ 5–10": 66, "Acima de R$ 10": 107 };

const VALOR: RangePreset[] = [
  { id: "ate-5", label: "Até R$ 5", range: { max: 5 } },
  { id: "5-10", label: "R$ 5–10", range: { min: 5, max: 10 } },
  { id: "acima-10", label: "Acima de R$ 10", range: { min: 10 } },
];

/** A ResizeObserver that reports one fixed width for whatever it observes. */
function stubWidth(width: number): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

beforeEach(() => {
  // jsdom lays nothing out: each measured label reports its natural LAYOUT
  // width, padding and border included. `offsetWidth`, not the bounding box:
  // the popover grows in from 75% scale, and a box read mid-transition is a
  // quarter short — which is how "Acima de R$ 10" was judged to fit and was
  // cut to "Acima de …" (FUT-4144 UI review round 2).
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.presetMeasure === undefined) return 0;
    return MEASURED[this.textContent ?? ""] ?? NATURAL;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ initial = {} }: { initial?: RangeValue }): React.JSX.Element {
  const [value, setValue] = useState<RangeValue>(initial);
  return (
    <>
      <RangePresets presets={PRESETS} value={value} onChange={setValue} testId="p" />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;

describe("presetsFitOneLine", () => {
  it("fits when every part, as wide as the widest label, shares the row", () => {
    // 5 × 96 + 4 gaps × 6 = 504
    expect(presetsFitOneLine(504, NATURAL, 5, 6)).toBe(true);
    expect(presetsFitOneLine(503, NATURAL, 5, 6)).toBe(false);
  });

  it("fits while nothing has been measured, so a server render and jsdom keep the buttons", () => {
    expect(presetsFitOneLine(null, NATURAL, 5, 6)).toBe(true);
  });
});

describe("RangePresets — one line (ADR 0190)", () => {
  it("is a segmented control of equal parts where the row is wide enough", () => {
    stubWidth(632);
    render(<Harness />);

    const row = screen.getByTestId("p-presets");
    expect(row).toHaveStyle({ display: "grid" });
    expect(within(row).getAllByRole("button")).toHaveLength(5);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("p-preset-mes"));
    expect(value()).toBe('{"min":"2026-10-01","max":"2026-10-31"}');
    expect(screen.getByTestId("p-preset-mes")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("p-preset-mes"));
    expect(value()).toBe("{}");
  });

  it("is a select with the same options, in order, where the row is too narrow", () => {
    stubWidth(288);
    render(<Harness />);

    const select = screen.getByTestId("p-presets-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Nenhum",
      "Hoje",
      "Ontem",
      "Esta semana",
      "Este mês",
      "Este ano",
    ]);
    expect(screen.getByRole("combobox", { name: "Atalho" })).toBe(select);
    expect(screen.queryAllByTestId("p-preset-hoje")).toHaveLength(0);

    fireEvent.change(select, { target: { value: "semana" } });
    expect(value()).toBe('{"min":"2026-10-25","max":"2026-10-31"}');
    expect(select).toHaveValue("semana");

    // Picking "Nenhum" is the select's way of picking the active one again.
    fireEvent.change(select, { target: { value: "" } });
    expect(value()).toBe("{}");
  });

  it("shows no preset chosen in the select for a window that is not one", () => {
    stubWidth(288);
    render(<Harness initial={{ min: "2026-10-03", max: "2026-10-09" }} />);
    expect(screen.getByTestId("p-presets-select")).toHaveValue("");
  });
});

describe("RangePresets — a number range's presets (FUT-4144 UI review round 2)", () => {
  function Valor(): React.JSX.Element {
    const [value, setValue] = useState<RangeValue>({});
    return (
      <>
        <RangePresets presets={VALOR} value={value} onChange={setValue} testId="v" />
        <output data-testid="value">{JSON.stringify(value)}</output>
      </>
    );
  }

  it("is a select where its widest label does not fit a third of the row", () => {
    // 3 × 107 + 2 × 6 = 333 > 288: "Acima de R$ 10" would be cut.
    stubWidth(288);
    render(<Valor />);
    const select = screen.getByTestId("v-presets-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Nenhum",
      "Até R$ 5",
      "R$ 5–10",
      "Acima de R$ 10",
    ]);
    fireEvent.change(select, { target: { value: "acima-10" } });
    expect(value()).toBe('{"min":10}');
  });

  it("is three equal parts where the row holds them", () => {
    // 3 × (107 + 1, the margin for offsetWidth's rounding) + 2 × 6 = 336.
    stubWidth(336);
    render(<Valor />);
    expect(within(screen.getByTestId("v-presets")).getAllByRole("button")).toHaveLength(3);
  });
});

describe("PanelRangeField — the calendar mounts only while its panel is open", () => {
  const FIELD: RangeFieldConfig<Record<string, unknown>> = {
    id: "data",
    label: "Data",
    kind: "day",
    accessor: () => "",
  };

  function Panel({ open }: { open: boolean }): React.JSX.Element {
    return (
      <TableFilterContext.Provider
        value={{ open, onOpenChange: () => undefined, hasActiveFilters: false, copy: PT_BR_TABLE_FILTER_COPY }}
      >
        <PanelRangeField field={FIELD} value={{}} onChange={() => undefined} testId="panel-data" />
      </TableFilterContext.Provider>
    );
  }

  it("holds no calendar while the panel is closed", () => {
    render(<Panel open={false} />);
    expect(screen.getByTestId("panel-data-min")).toBeInTheDocument();
    expect(screen.queryAllByTestId("panel-data-calendar")).toHaveLength(0);
  });

  it("mounts the calendar when the panel opens", () => {
    const { rerender } = render(<Panel open={false} />);
    rerender(<Panel open />);
    expect(screen.getByTestId("panel-data-calendar")).toBeInTheDocument();
  });
});
