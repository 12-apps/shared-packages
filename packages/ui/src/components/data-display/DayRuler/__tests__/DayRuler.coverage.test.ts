/**
 * The coverage line's fill (FUT-3831): the prototype's tonal success step, deeper per person on
 * the escala, so a staffed hour reads against an empty one in both modes — lighter than empty in
 * dark, plainly coloured in light, where the soft-signal blend matched the empty grey.
 */
import { createTheme, decomposeColor, getLuminance, type Theme } from "@mui/material/styles/index.js";
import { describe, expect, it } from "vitest";

import { coverageCellSx, coverageStrength } from "../DayRuler.styles";

type Rgb = [number, number, number];

/** A CSS colour with alpha, laid over an opaque page colour. */
function over(colour: string, page: string): string {
  const top = decomposeColor(colour);
  const base = decomposeColor(page).values.slice(0, 3) as Rgb;
  const a = top.values[3] ?? 1;
  const rgb = (top.values.slice(0, 3) as Rgb).map((channel, i) => Math.round(channel * a + base[i]! * (1 - a)));
  return `rgb(${rgb.join(", ")})`;
}

function cell(theme: Theme, count: number): { fill: string; ink: string } {
  const sx = coverageCellSx(count) as (t: Theme) => { backgroundColor: string; color: string };
  const style = sx(theme);
  return { fill: over(style.backgroundColor, theme.palette.background.paper), ink: style.color };
}

describe("coverageStrength", () => {
  it("is none for an empty hour, deeper per person, and capped", () => {
    expect(coverageStrength(0)).toBe(0);
    expect(coverageStrength(1)).toBeCloseTo(0.27);
    expect(coverageStrength(3)).toBeCloseTo(0.45);
    expect(coverageStrength(5)).toBeCloseTo(0.63);
    expect(coverageStrength(20)).toBe(0.85);
  });
});

describe("the staffed hour against the empty one", () => {
  it("is lighter than empty in dark mode", () => {
    const dark = createTheme({ palette: { mode: "dark" } });
    const empty = getLuminance(cell(dark, 0).fill);
    for (const count of [1, 3, 5]) expect(getLuminance(cell(dark, count).fill)).toBeGreaterThan(empty);
  });

  it("is a visibly different colour in light mode, and its count stays legible", () => {
    const light = createTheme({ palette: { mode: "light" } });
    const empty = cell(light, 0).fill;
    for (const count of [1, 3, 5]) {
      const { fill, ink } = cell(light, count);
      expect(fill).not.toBe(empty);
      const lum = [getLuminance(fill), getLuminance(ink)].sort((a, b) => b - a) as [number, number];
      expect((lum[0] + 0.05) / (lum[1] + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });
});
