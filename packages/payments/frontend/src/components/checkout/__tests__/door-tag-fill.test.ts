/**
 * FUT-5290 — the door tag's fill reads the theme's soft warning signal when it
 * has one, and falls back to a light tint of the warning tone without it.
 */
import { createTheme, type Theme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";

import { tagFill } from "../list/option-row";

const withSignal = (warning: string): Theme => Object.assign(createTheme(), { uiSoftSignal: { warning } });

describe("tagFill", () => {
  it("uses the theme's soft warning signal in light mode", () => {
    expect(tagFill(withSignal("#FFF2DD"))).toBe("#FFF2DD");
  });

  it("falls back to a light tint of the warning tone without the signal", () => {
    const fill = tagFill(createTheme());
    expect(fill).toMatch(/^(#|rgb)/);
    expect(fill).not.toBe("#FFF2DD");
  });

  it("keeps the translucent night branch even when the signal exists", () => {
    const dark = Object.assign(createTheme({ palette: { mode: "dark" } }), { uiSoftSignal: { warning: "#FFF2DD" } });
    expect(tagFill(dark)).toMatch(/^rgba\(/);
  });
});
