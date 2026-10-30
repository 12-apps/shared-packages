/**
 * The day filter's summary and its "Limpar" live on the calendar's hint line
 * (FUT-4144 follow-up).
 *
 * #932 held an invisible "Data: … · Limpar" row under the hint until the first
 * tap, so the popover would not grow under the finger. At 1280 that left 59px
 * of white under "Toque no primeiro e no último dia." — the owner's "no empty
 * space". The hint's own line now carries the step and, once something is
 * applied, the window and "Limpar": one line whose words change, nothing held.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";

import { fireEvent, render, screen, waitFor, within } from "./test-utils";
import { RangeBounds } from "../data-views-range-bounds";
import { RangePill } from "../data-views-range-pill";
import type { RangeFieldConfig, RangeValue } from "../data-views-types";

interface Row extends Record<string, unknown> {
  day: string;
  amount: number;
}

const PERIOD: RangeFieldConfig<Row> = { id: "period", label: "Data", kind: "day", accessor: (row) => row.day };
const TOTAL: RangeFieldConfig<Row> = { id: "total", label: "Valor", unit: "R$", accessor: (row) => row.amount };
const TEST_ID = "grid-range-period";

function Pill({ field = PERIOD, initial = {} }: { field?: RangeFieldConfig<Row>; initial?: RangeValue }): React.JSX.Element {
  const [value, setValue] = useState<RangeValue>(initial);
  return <RangePill field={field} value={value} onChange={setValue} testIdPrefix="grid" />;
}

const hint = () => screen.getByTestId(`${TEST_ID}-calendar-hint`);
/** The hint's line: the step or the window, and "Limpar" when there is one. */
const line = () => screen.getByTestId(`${TEST_ID}-calendar-line`);
const day = (name: string) => within(screen.getByTestId(`${TEST_ID}-calendar`)).getByRole("gridcell", { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 28, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RangePill — the summary on the hint line", () => {
  it("holds no hidden summary row while nothing is picked", () => {
    render(<Pill />);
    fireEvent.click(screen.getByTestId(TEST_ID));

    expect(hint()).toHaveTextContent("Toque no primeiro e no último dia.");
    expect(within(line()).queryAllByRole("button")).toHaveLength(0);
    // Nothing invisible standing in for the row #932 held.
    expect(screen.getByRole("presentation").querySelectorAll('[aria-hidden="true"] button')).toHaveLength(0);
    expect(screen.queryAllByText("Limpar")).toHaveLength(0);
  });

  it("asks for the last day, with Limpar on the same line, after the first tap", () => {
    render(<Pill />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    fireEvent.click(day("1 de outubro de 2026"));

    expect(hint()).toHaveTextContent("Agora toque no último dia.");
    expect(within(line()).getByTestId(`${TEST_ID}-clear`)).toHaveTextContent("Limpar");
  });

  it("says the window with Limpar at its end once the period is picked, and Limpar empties it", () => {
    render(<Pill />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    fireEvent.click(day("1 de outubro de 2026"));
    fireEvent.click(day("15 de outubro de 2026"));

    expect(hint()).toHaveTextContent("Data: 01/10–15/10");
    const clear = within(line()).getByTestId(`${TEST_ID}-clear`);
    // One "Limpar" in the popover: the line's, not a second row's.
    expect(within(screen.getByRole("presentation")).getAllByText("Limpar")).toHaveLength(1);

    fireEvent.click(clear);
    expect(hint()).toHaveTextContent("Toque no primeiro e no último dia.");
    expect(screen.getByTestId(`${TEST_ID}-min`)).toHaveValue("");
    expect(within(line()).queryAllByRole("button")).toHaveLength(0);
  });

  it("starts a new period from the next tap after Limpar mid-pick", () => {
    render(<Pill />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    fireEvent.click(day("1 de outubro de 2026"));
    fireEvent.click(within(line()).getByTestId(`${TEST_ID}-clear`));
    expect(hint()).toHaveTextContent("Toque no primeiro e no último dia.");

    fireEvent.click(day("9 de outubro de 2026"));

    expect(screen.getByTestId(`${TEST_ID}-min`)).toHaveValue("09/10/2026");
    expect(screen.getByTestId(`${TEST_ID}-max`)).toHaveValue("");
    expect(hint()).toHaveTextContent("Agora toque no último dia.");
  });

  it("says a preset's window on the line too", () => {
    render(<Pill initial={{ min: "2026-10-01", max: "2026-10-31" }} />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    expect(hint()).toHaveTextContent("Data: 01/10–31/10");
    expect(within(line()).getByTestId(`${TEST_ID}-clear`)).toBeInTheDocument();
  });

  it("keeps a number range's own summary row, as before", () => {
    render(<Pill field={TOTAL} initial={{ min: 20 }} />);
    fireEvent.click(screen.getByTestId("grid-range-total"));
    expect(screen.getByTestId("grid-range-total-clear")).toHaveTextContent("Limpar");
    expect(within(screen.getByRole("presentation")).getByText("Valor: ≥ R$ 20")).toBeInTheDocument();
  });
});

describe("RangePill — the line's ink (FUT-4144 UI review)", () => {
  // The default theme's two text inks, as jsdom computes them.
  const SECONDARY = "rgba(0, 0, 0, 0.6)";
  const PRIMARY = "rgba(0, 0, 0, 0.87)";

  it("says the steps in the secondary ink and the applied window in the primary one", () => {
    render(<Pill />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    expect(getComputedStyle(hint()).color).toBe(SECONDARY);

    fireEvent.click(day("1 de outubro de 2026"));
    expect(getComputedStyle(hint()).color).toBe(SECONDARY);

    fireEvent.click(day("15 de outubro de 2026"));
    expect(hint()).toHaveTextContent("Data: 01/10–15/10");
    expect(getComputedStyle(hint()).color).toBe(PRIMARY);
  });
});

describe("the hint line's room, wrap and focus (FUT-4144 code review)", () => {
  it("reserves Limpar's 40px only where the line can hold Limpar", () => {
    function Panel(): React.JSX.Element {
      const [value, setValue] = useState<RangeValue>({});
      return <RangeBounds field={PERIOD} value={value} onChange={setValue} testId="panel-period" />;
    }
    render(
      <>
        <Pill />
        <Panel />
      </>,
    );
    fireEvent.click(screen.getByTestId(TEST_ID));
    // The pill's line holds a 40px row from the start, so it never grows.
    expect(getComputedStyle(line()).minHeight).not.toBe("");
    expect(getComputedStyle(line()).minHeight).not.toBe("0px");
    // A panel's line never shows Limpar (its header has it): no reserved row.
    const panelLine = screen.getByTestId("panel-period-calendar-line");
    expect(["", "0px", "auto"]).toContain(getComputedStyle(panelLine).minHeight);
  });

  it("keeps a long window on one line, cut with an ellipsis and whole in its title", () => {
    const LONG: RangeFieldConfig<Row> = { ...PERIOD, label: "Data de criação" };
    render(<Pill field={LONG} initial={{ min: "2026-10-01", max: "2026-10-15" }} />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    expect(hint()).toHaveTextContent("Data de criação: 01/10–15/10");
    expect(hint()).toHaveAttribute("title", "Data de criação: 01/10–15/10");
    expect(getComputedStyle(hint()).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(hint()).textOverflow).toBe("ellipsis");
  });

  it("puts focus in De after Limpar pressed from the keyboard, not on the page", async () => {
    render(<Pill initial={{ min: "2026-10-01", max: "2026-10-15" }} />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    fireEvent.click(within(line()).getByTestId(`${TEST_ID}-clear`), { detail: 0 });
    await waitFor(() => expect(screen.getByTestId(`${TEST_ID}-min`)).toHaveFocus());
  });

  it("leaves De unfocused after a tapped Limpar, so no phone keyboard covers the calendar", async () => {
    render(<Pill initial={{ min: "2026-10-01", max: "2026-10-15" }} />);
    fireEvent.click(screen.getByTestId(TEST_ID));
    fireEvent.click(within(line()).getByTestId(`${TEST_ID}-clear`), { detail: 1 });
    await waitFor(() => {
      expect(hint()).toHaveTextContent("Toque no primeiro e no último dia.");
      expect(screen.getByTestId(`${TEST_ID}-min`)).not.toHaveFocus();
    });
  });
});

describe("RangeBounds in a panel — the hint line stays the step only", () => {
  it("shows no window and no Limpar of its own: the panel's header has them", () => {
    function Panel(): React.JSX.Element {
      const [value, setValue] = useState<RangeValue>({ min: "2026-10-01", max: "2026-10-15" });
      return <RangeBounds field={PERIOD} value={value} onChange={setValue} testId={TEST_ID} />;
    }
    render(<Panel />);
    expect(hint()).toHaveTextContent("Toque no primeiro e no último dia.");
    expect(screen.queryAllByTestId(`${TEST_ID}-clear`)).toHaveLength(0);
  });
});
