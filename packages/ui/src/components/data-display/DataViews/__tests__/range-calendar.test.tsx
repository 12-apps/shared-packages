/**
 * The range calendar under a day filter's `De`/`Até` boxes (FUT-4144, option B).
 *
 * The owner picked a calendar that is ALWAYS open in the filter's popover: a
 * period is three taps (open the filter, the first day, the last day), and the
 * typed path is not made one keystroke longer. The calendar and the two boxes
 * are two views of ONE range — each case below pins one direction of that.
 *
 * The day-input tests (`day-input.test.tsx`) and the pill tests
 * (`range-pill.test.tsx`) are untouched: this file only adds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

import { fireEvent, render, screen, waitFor, within } from "./test-utils";
import { PanelRangeField, RangePill } from "../data-views-range-pill";
import type { RangeFieldConfig, RangeValue } from "../data-views-types";

interface Row extends Record<string, unknown> {
  day: string;
}

const PERIOD: RangeFieldConfig<Row> = {
  id: "period",
  label: "Data",
  kind: "day",
  accessor: (row) => row.day,
};

const TEST_ID = "grid-range-period";

/** The pill, holding its own range the way the grid's state does. */
function Harness({
  initial = {},
  onChange,
}: {
  initial?: RangeValue;
  onChange: (range: RangeValue) => void;
}): React.JSX.Element {
  const [value, setValue] = useState<RangeValue>(initial);
  return (
    <RangePill
      field={PERIOD}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      testIdPrefix="grid"
    />
  );
}

function open(initial?: RangeValue) {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  fireEvent.click(screen.getByTestId(TEST_ID));
  return { onChange };
}

const field = (bound: "min" | "max") => screen.getByTestId(`${TEST_ID}-${bound}`) as HTMLInputElement;
const calendar = () => screen.getByTestId(`${TEST_ID}-calendar`);
/** A day by its pt-BR name: the same words a screen reader says for it. */
const day = (name: string) => within(calendar()).getByRole("gridcell", { name });
const selectedDays = () =>
  within(calendar())
    .getAllByRole("gridcell")
    .filter((cell) => cell.getAttribute("aria-selected") === "true")
    .map((cell) => cell.getAttribute("aria-label"));

beforeEach(() => {
  // Only the clock: "today" is 28/10/2026, the day the prototype measured on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 28, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RangePill — the day calendar (FUT-4144, option B)", () => {
  it("is open with the popover, on this month, with no button to reach it", () => {
    open();
    expect(within(calendar()).getByRole("grid", { name: "outubro de 2026" })).toBeInTheDocument();
    expect(screen.getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent(
      "Toque no primeiro e no último dia.",
    );
  });

  it("sets De and Até from two taps on the calendar", () => {
    const { onChange } = open();

    fireEvent.click(day("1 de outubro de 2026"));
    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-01" });
    expect(field("min")).toHaveValue("01/10/2026");
    expect(screen.getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent("Agora toque no último dia.");

    fireEvent.click(day("15 de outubro de 2026"));
    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-01", max: "2026-10-15" });
    expect(field("min")).toHaveValue("01/10/2026");
    expect(field("max")).toHaveValue("15/10/2026");
    expect(screen.getByTestId(TEST_ID)).toHaveTextContent("Data: 01/10–15/10");
    expect(selectedDays()).toEqual(["1 de outubro de 2026", "15 de outubro de 2026"]);
  });

  it("swaps the two days when the later one is tapped first", () => {
    const { onChange } = open();

    fireEvent.click(day("15 de outubro de 2026"));
    fireEvent.click(day("1 de outubro de 2026"));

    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-01", max: "2026-10-15" });
    expect(field("min")).toHaveValue("01/10/2026");
    expect(field("max")).toHaveValue("15/10/2026");
    // In order, so the note is the inclusive one, not the inverted-window one.
    expect(screen.getByTestId(`${TEST_ID}-inclusive`)).toHaveTextContent("Ambas as datas entram no resultado.");
  });

  it("keeps a typed Até when only De is then tapped before it", () => {
    const { onChange } = open({ max: "2026-10-15" });

    fireEvent.click(day("3 de outubro de 2026"));

    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-03", max: "2026-10-15" });
  });

  it("still takes a typed date, and the calendar moves to it", () => {
    const { onChange } = open();

    fireEvent.change(field("min"), { target: { value: "05/11/2026" } });

    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-11-05" });
    expect(within(calendar()).getByRole("grid", { name: "novembro de 2026" })).toBeInTheDocument();
    expect(selectedDays()).toEqual(["5 de novembro de 2026"]);

    fireEvent.change(field("max"), { target: { value: "20/11/2026" } });
    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-11-05", max: "2026-11-20" });
    expect(selectedDays()).toEqual(["5 de novembro de 2026", "20 de novembro de 2026"]);
  });

  it("leaves the calendar as it was when the typed day does not exist", () => {
    const { onChange } = open({ min: "2026-10-01", max: "2026-10-15" });
    const before = selectedDays();

    fireEvent.change(field("min"), { target: { value: "31/02/2026" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(field("min")).toHaveAttribute("aria-invalid", "true");
    expect(within(calendar()).getByRole("grid", { name: "outubro de 2026" })).toBeInTheDocument();
    expect(selectedDays()).toEqual(before);
  });

  it("clears both boxes and the calendar from Limpar", () => {
    const { onChange } = open();
    fireEvent.click(day("1 de outubro de 2026"));
    fireEvent.click(day("15 de outubro de 2026"));

    fireEvent.click(screen.getByTestId(`${TEST_ID}-clear`));

    expect(onChange).toHaveBeenLastCalledWith({});
    expect(field("min")).toHaveValue("");
    expect(field("max")).toHaveValue("");
    expect(selectedDays()).toEqual([]);
    expect(screen.getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent(
      "Toque no primeiro e no último dia.",
    );
  });

  it("is a grid of pt-BR-named days that the arrow keys walk and Enter picks", async () => {
    const { onChange } = open({ min: "2026-10-01" });
    const grid = within(calendar()).getByRole("grid", { name: "outubro de 2026" });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);

    // The range's start is the grid's one tab stop. A key pressed ON a day
    // carries the focus with the tab stop, so the ring follows the arrows.
    const start = day("1 de outubro de 2026");
    expect(start).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(day("2 de outubro de 2026"), { key: "ArrowDown" });
    const target = day("9 de outubro de 2026");
    expect(target).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(target).toHaveFocus());

    fireEvent.keyDown(target, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-01", max: "2026-10-09" });
    expect(field("max")).toHaveValue("09/10/2026");
  });

  it("names its month arrows in pt-BR", () => {
    open();
    expect(within(calendar()).getByRole("button", { name: "Mês anterior" })).toBeInTheDocument();
    expect(within(calendar()).getByRole("button", { name: "Próximo mês" })).toBeInTheDocument();
  });

  it("leaves a numeric range without a calendar", () => {
    const onChange = vi.fn();
    render(
      <RangePill
        field={{ id: "total", label: "Valor", unit: "R$", accessor: () => 0 }}
        value={{}}
        onChange={onChange}
        testIdPrefix="grid"
      />,
    );
    fireEvent.click(screen.getByTestId("grid-range-total"));
    expect(screen.getByTestId("grid-range-total-min")).toBeInTheDocument();
    expect(screen.queryAllByRole("grid")).toHaveLength(0);
  });
});

describe("PanelRangeField — the same calendar on the slide-in panel", () => {
  it("writes the panel's boxes from two taps", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const onChange = vi.fn();
    function Panel(): React.JSX.Element {
      const [value, setValue] = useState<RangeValue>({});
      return (
        <PanelRangeField
          field={PERIOD}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          testId="panel-period"
        />
      );
    }
    render(<Panel />);
    const panelCalendar = screen.getByTestId("panel-period-calendar");

    fireEvent.click(within(panelCalendar).getByRole("gridcell", { name: "10 de outubro de 2026" }));
    fireEvent.click(within(panelCalendar).getByRole("gridcell", { name: "12 de outubro de 2026" }));

    expect(onChange).toHaveBeenLastCalledWith({ min: "2026-10-10", max: "2026-10-12" });
    expect(screen.getByTestId("panel-period-max")).toHaveValue("12/10/2026");
  });
});
