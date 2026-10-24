import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { Calendar } from "../Calendar";

// `fontSize: 12` scales every design px by 12/14 — the density a compact host sets.
const theme = createTheme({ typography: { fontSize: 12 } });
const r = (px: number) => theme.typography.pxToRem(px);

describe("Calendar under a non-default type scale", () => {
  it("sizes the day cells, the weekday row and the month through the type scale", () => {
    render(
      <ThemeProvider theme={theme}>
        <Calendar ariaLabel="Datas" value={new Date(2026, 0, 15)} locale="pt-BR" />
      </ThemeProvider>,
    );
    const day = screen.getByTestId("calendar-date-5");
    // A square that fills its column up to 40 design px (FUT-3861).
    expect(getComputedStyle(day).maxWidth).toBe(r(40));
    expect(getComputedStyle(day).aspectRatio.replace(/\s/g, "")).toBe("1/1");

    const weekday = screen.getByTestId("calendar-weekday-0");
    expect(getComputedStyle(weekday).height).toBe(r(32));
    expect(getComputedStyle(weekday).fontSize).toBe(r(14));

    const month = getComputedStyle(screen.getByTestId("calendar-month-0"));
    expect(month.maxWidth).toBe(r(304));
    expect(parseFloat(month.minWidth)).toBe(0);
  });
});
