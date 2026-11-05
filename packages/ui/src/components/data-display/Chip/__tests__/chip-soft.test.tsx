/**
 * A soft chip is a status chip: the colour's tint for a ground, its dark step
 * for ink in light mode and its light step in dark mode (FUT-4442). It reaches
 * MUI as `filled` (MUI has no third variant), never as an unknown variant MUI
 * would drop.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { afterEach, describe, expect, it } from "vitest";

import { Chip } from "../Chip";

const theme = createTheme();

function soft(color: "danger" | "neutral"): HTMLElement {
  render(
    <ThemeProvider theme={theme}>
      <Chip label="Cancelado" variant="soft" color={color} dataTestId={`chip-${color}`} />
    </ThemeProvider>,
  );
  return screen.getByTestId(`chip-${color}`);
}

describe("Chip variant soft", () => {
  it("paints the colour's tint with its dark ink", () => {
    const chip = soft("danger");
    expect(chip.className).toContain("MuiChip-filled");
    const style = getComputedStyle(chip);
    expect(style.color).toBe("rgb(198, 40, 40)"); // error.dark
    expect(style.backgroundColor).toBe("rgba(211, 47, 47, 0.14)"); // error.main at the soft alpha
    expect(style.fontWeight).toBe("600");
  });

  it("gives a neutral soft chip the selected ground and the secondary ink", () => {
    const style = getComputedStyle(soft("neutral"));
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0.08)"); // action.selected
    expect(style.color).toBe("rgba(0, 0, 0, 0.6)"); // text.secondary
  });
});

/* ── Dark mode (FUT-4442): the ink must read on the tint over `background.paper` ── */

/** WCAG 2.1 AA for normal-size text; the 13px semibold label is not large text. */
const MIN_CONTRAST = 4.5;

type Rgba = [number, number, number, number];

function parse(input: string): Rgba {
  const colour = input.startsWith("#") ? rgbOf(input) : input;
  const parts = colour.match(/[\d.]+/gu)?.map(Number);
  if (!parts || parts.length < 3) throw new Error(`unreadable colour: ${colour}`);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

function over([r, g, b, a]: Rgba, [br, bg, bb]: readonly number[] & { 0: number; 1: number; 2: number }): [number, number, number] {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const COLOURS = ["primary", "secondary", "success", "warning", "danger", "info"] as const;

const darkTheme = createTheme({
  palette: { mode: "dark", primary: { main: "#818CF8" }, secondary: { main: "#A78BFA" } },
});
const seededWarning = createTheme({
  palette: { mode: "dark", primary: { main: "#818CF8" }, secondary: { main: "#A78BFA" }, warning: { main: "#CF960C" } },
});

afterEach(cleanup);

function renderDark(
  t: typeof darkTheme,
  color: (typeof COLOURS)[number],
  extra: { deletable?: boolean } = {},
): HTMLElement {
  render(
    <ThemeProvider theme={t}>
      <Chip
        label="Aguardando"
        variant="soft"
        color={color}
        dataTestId={`dark-${color}`}
        onDelete={extra.deletable ? () => undefined : undefined}
        deletable={extra.deletable}
      />
    </ThemeProvider>,
  );
  return screen.getByTestId(`dark-${color}`);
}

/** The ink's contrast on the chip's own ground composited over the page. */
function inkContrast(t: typeof darkTheme, chip: HTMLElement): number {
  const style = getComputedStyle(chip);
  const paper = parse(t.palette.background.paper);
  const ground = over(parse(style.backgroundColor), paper);
  return ratio(over(parse(style.color), ground), ground);
}

describe("Chip variant soft in dark mode", () => {
  it.each(COLOURS)("clears 4.5:1 for %s on the tint over the paper", (color) => {
    expect(inkContrast(darkTheme, renderDark(darkTheme, color))).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("clears 4.5:1 for a host-seeded warning (#CF960C)", () => {
    const chip = renderDark(seededWarning, "warning");
    expect(inkContrast(seededWarning, chip)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(getComputedStyle(chip).color).toBe(rgbOf(seededWarning.palette.warning.light));
  });

  it("keeps the resting ground on focus and draws a ring in the ink", () => {
    for (const color of COLOURS) {
      const chip = renderDark(darkTheme, color);
      const rest = getComputedStyle(chip).backgroundColor;
      const ink = getComputedStyle(chip).color;
      chip.classList.add("Mui-focusVisible");
      const style = getComputedStyle(chip);
      expect(style.backgroundColor).toBe(rest);
      expect(inkContrast(darkTheme, chip)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(style.outlineStyle).toBe("solid");
      expect(style.outlineWidth).toBe("0.125rem");
      expect(style.outlineOffset).toBe("0.125rem");
      expect(style.outlineColor).toBe(ink);
      // The ring against the page itself.
      const paper = parse(darkTheme.palette.background.paper);
      expect(ratio(over(parse(style.outlineColor), paper), over([...paper.slice(0, 3), 1] as Rgba, paper))).toBeGreaterThanOrEqual(3);
      cleanup();
    }
  });

  it("paints a deletable chip's glyph in the ink, not in contrastText", () => {
    const chip = renderDark(darkTheme, "danger", { deletable: true });
    const glyph = screen.getByTestId("dark-danger-delete");
    expect(chip.contains(glyph)).toBe(true);
    expect(getComputedStyle(glyph).color).toBe(getComputedStyle(chip).color);
    expect(getComputedStyle(glyph).color).toBe(rgbOf(darkTheme.palette.error.light));
  });

  it("leaves a neutral soft chip's glyph and focus exactly as MUI paints them", () => {
    for (const [mode, glyph] of [["light", "rgba(0, 0, 0, 0.26)"], ["dark", "rgba(255, 255, 255, 0.26)"]] as const) {
      render(
        <ThemeProvider theme={createTheme({ palette: { mode } })}>
          <Chip label="x" variant="soft" color="neutral" deletable onDelete={() => undefined} dataTestId={`n-${mode}`} />
        </ThemeProvider>,
      );
      expect(getComputedStyle(screen.getByTestId(`n-${mode}-delete`)).color).toBe(glyph);
      const chip = screen.getByTestId(`n-${mode}`);
      chip.classList.add("Mui-focusVisible");
      expect(getComputedStyle(chip).outlineStyle).not.toBe("solid");
    }
  });

  it("keeps the dark step for light mode's ink (unchanged)", () => {
    const chip = soft("danger");
    expect(getComputedStyle(chip).color).toBe(rgbOf(theme.palette.error.dark));
  });
});

/** A hex or `rgb()` colour as the DOM resolves it. */
function rgbOf(colour: string): string {
  if (colour.startsWith("rgb")) return colour.replace(/,(?=\S)/gu, ", ");
  const hex = colour.length === 4 ? [...colour.slice(1)].map((c) => c + c).join("") : colour.slice(1);
  const n = parseInt(hex, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("Chip variant soft, focused, in light mode (FUT-4461)", () => {
  it("keeps the resting ground, a readable label and a ring in the ink", () => {
    const light = createTheme();
    for (const color of COLOURS) {
      render(
        <ThemeProvider theme={light}>
          <Chip label="x" variant="soft" color={color} deletable onDelete={() => undefined} dataTestId={`l-${color}`} />
        </ThemeProvider>,
      );
      const chip = screen.getByTestId(`l-${color}`);
      const glyph = screen.getByTestId(`l-${color}-delete`);
      const rest = getComputedStyle(chip).backgroundColor;
      chip.classList.add("Mui-focusVisible");
      const style = getComputedStyle(chip);
      expect(style.backgroundColor).toBe(rest);
      expect(style.outlineStyle).toBe("solid");
      expect(style.outlineWidth).toBe("0.125rem");
      expect(style.outlineOffset).toBe("0.125rem");
      expect(style.outlineColor).toBe(style.color);
      const page = parse(light.palette.background.paper);
      const ground = over(parse(style.backgroundColor), page);
      const g = [ground[0], ground[1], ground[2]] as const;
      expect(ratio(over(parse(style.color), g), g)).toBeGreaterThanOrEqual(3);
      expect(ratio(over(parse(getComputedStyle(glyph).color), g), g)).toBeGreaterThanOrEqual(3);
      cleanup();
    }
  });
});
