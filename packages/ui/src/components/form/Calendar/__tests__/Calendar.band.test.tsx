import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTheme } from "../../../../mui/styles";
import { DEFAULT_BRAND } from "../../../../tokens/theme";
import { getContrastRatio } from "../../../../tokens/color";
import { bandFor, endpointFill, endpointHoverFill } from "../Calendar.band";
import type { DayRenderArgs } from "../Calendar.types";
import { Calendar } from "../Calendar";

const day = (date: number, flags: Partial<DayRenderArgs> = {}): DayRenderArgs => ({
  date: new Date(2026, 9, date, 12),
  inCurrentMonth: true,
  selected: false,
  inRange: false,
  rangeStart: false,
  rangeEnd: false,
  disabled: false,
  today: false,
  ...flags,
});
const on = (date: number) => new Date(2026, 9, date, 12);
const never = () => false;
const brandTheme = () => createTheme({ palette: { primary: { main: DEFAULT_BRAND.light.primary } } });

describe("the range band (FUT-4162)", () => {
  const range = { start: on(13), end: on(22) };

  it("runs across the inside days and the inner half of each endpoint", () => {
    const band = (args: DayRenderArgs) =>
      bandFor({ args, selectionMode: "range", range, hoveredDate: null, isDisabled: never });
    expect(band(day(13, { rangeStart: true, selected: true }))).toBe("after");
    expect(band(day(17, { inRange: true }))).toBe("full");
    expect(band(day(22, { rangeEnd: true, selected: true }))).toBe("before");
    expect(band(day(23))).toBe("none");
  });

  it("previews towards the hovered day while only the start is chosen", () => {
    const partial = { start: on(13), end: null };
    const band = (args: DayRenderArgs, hoveredDate: Date) =>
      bandFor({ args, selectionMode: "range", range: partial, hoveredDate, isDisabled: never });
    expect(band(day(13, { rangeStart: true }), on(20))).toBe("after");
    expect(band(day(20, { hovered: true }), on(20))).toBe("before");
    expect(band(day(13, { rangeStart: true }), on(9))).toBe("before");
  });

  it("paints nothing for one day, a disabled hover, or single selection", () => {
    const one = { start: on(13), end: on(13) };
    expect(bandFor({ args: day(13, { rangeStart: true }), selectionMode: "range", range: one, hoveredDate: null, isDisabled: never })).toBe("none");
    expect(bandFor({ args: day(13, { rangeStart: true }), selectionMode: "range", range: { start: on(13), end: null }, hoveredDate: on(20), isDisabled: () => true })).toBe("none");
    expect(bandFor({ args: day(17, { inRange: true }), selectionMode: "single", range, hoveredDate: null, isDisabled: never })).toBe("none");
  });

  it("lays the days out with no column gap", () => {
    render(<Calendar ariaLabel="Datas" selectionMode="range" range={range} defaultMonth={on(1)} locale="pt-BR" />);
    for (const grid of screen.getAllByTestId("calendar-grid")) {
      expect(parseFloat(getComputedStyle(grid).columnGap)).toBe(0);
    }
  });
});

describe("the endpoint fill (FUT-4162)", () => {
  // `#6366F1` is the default brand: white reads at 4.47:1 on it. `#0288D1`
  // takes white too (MUI's 3:1 rule) at 3.86:1. `#FF9800` takes dark ink.
  it.each(["#6366F1", "#0288D1", "#FF9800", "#2E7D32"])("reads at AA under its own ink on %s", (primary) => {
    const theme = createTheme({ palette: { primary: { main: primary } } });
    const ink = theme.palette.primary.contrastText;
    expect(getContrastRatio(ink, endpointFill(theme))).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(ink, endpointHoverFill(theme))).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a brand that already passes as it is", () => {
    const theme = createTheme({ palette: { primary: { main: "#2E7D32" } } });
    expect(endpointFill(theme)).toBe(theme.palette.primary.main);
  });

  it("moves the default indigo by no more than a few percent", () => {
    const theme = brandTheme();
    expect(endpointFill(theme)).not.toBe(theme.palette.primary.main);
    expect(getContrastRatio(endpointFill(theme), theme.palette.primary.main)).toBeLessThan(1.1);
  });
});
