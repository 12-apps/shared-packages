/**
 * A BANNER MUST BE READABLE WHEREVER IT IS PUT.
 *
 * The Alert filled itself with `alpha(main, 0.1)` and painted body text in
 * `main` itself. Both halves failed, and independently:
 *
 *   - the FILL was translucent, so the component silently depended on a
 *     consumer placing it over something opaque. Floated over content — a
 *     notice above a catalogue, an install invite anchored over a product grid
 *     — the page came through and the sentence interleaved with whatever was
 *     behind it;
 *   - the INK was the severity hue at body size. `#0288d1`, the info blue, is
 *     3.03:1 on white, under the 4.5:1 WCAG AA floor, on a plain page where the
 *     fill was doing exactly what it meant to.
 *
 * Neither was visible to the existing suite: the Alert rendered, its text was
 * present, its roles and testids matched. So these tests assert the two things
 * that were actually wrong — that the surface is OPAQUE, and that the ink
 * CLEARS the floor against it — rather than anything about markup.
 *
 * The ratios are computed from `getComputedStyle`, so they measure what a
 * browser resolves rather than what the source declares.
 */
import { render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from '@mui/material';
import { describe, expect, it } from "vitest";

import { Alert } from "../Alert";

/** WCAG 2.1 AA for normal-size text. */
const MIN_CONTRAST = 4.5;

const VARIANTS = ["info", "success", "warning", "danger"] as const;
type Variant = (typeof VARIANTS)[number] | "glass";

function channels(colour: string): [number, number, number] {
  const parts = colour.match(/[\d.]+/gu);
  if (!parts || parts.length < 3) throw new Error(`unreadable colour: ${colour}`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** The alpha of an `rgba()`, or 1 for any opaque form. */
function opacityOf(colour: string): number {
  const parts = colour.match(/[\d.]+/gu);
  return parts && parts.length > 3 ? Number(parts[3]) : 1;
}

function luminance(colour: string): number {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(colour);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function renderAlert(variant: Variant, mode: "light" | "dark"): CSSStyleDeclaration {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <Alert variant={variant} description="mensagem" data-testid={`alert-${variant}`} />
    </ThemeProvider>,
  );
  return getComputedStyle(screen.getByTestId(`alert-${variant}`));
}

describe.each(["light", "dark"] as const)("a %s-mode semantic Alert", (mode) => {
  it.each(VARIANTS)("paints %s on an opaque surface", (variant) => {
    const style = renderAlert(variant, mode);
    // The alpha channel IS the bug. A wash over a product photo is not a
    // banner, so the assertion is opacity rather than an exact colour.
    expect(opacityOf(style.backgroundColor)).toBe(1);
    expect(style.backgroundColor).not.toBe("transparent");
  });

  it.each(VARIANTS)("clears the AA text floor for %s", (variant) => {
    const style = renderAlert(variant, mode);
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe("the old fill", () => {
  it("did NOT clear the floor, so this suite is the fix and not a restatement", () => {
    // What the component used to paint body text in, on the page it assumed.
    const info = createTheme({ palette: { mode: "light" } }).palette.info.main;
    const asRgb = (hex: string): string => {
      const n = Number.parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(contrastRatio(asRgb(info), "rgb(255, 255, 255)")).toBeLessThan(MIN_CONTRAST);
  });
});

describe("the glass variant", () => {
  it("is mostly pane, so the blur has something to frost", () => {
    const style = renderAlert("glass", "light");
    const opacity = opacityOf(style.backgroundColor);
    // It is MEANT to be see-through — but at the old 0.1 it was a window, not
    // frosted glass, and the text competed with whatever was behind it.
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeGreaterThanOrEqual(0.8);
  });
});
