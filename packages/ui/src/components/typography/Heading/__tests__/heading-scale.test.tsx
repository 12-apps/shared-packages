/**
 * THE RANK AND THE SIZE ARE TWO DIFFERENT QUESTIONS, AND THE SCALE IS THE
 * THEME'S TO SET.
 *
 * `level` used to answer three at once: which tag, which rank in the outline,
 * and how big. The metrics lived in a private `LEVELS` table inside
 * `Heading.styles.ts`, so:
 *
 *   - a host could not re-theme them. `createTheme({ typography: { h1: … } })`
 *     moved `<Typography>` and left `<Heading>` alone, silently;
 *   - and a caller who needed an `h1` drawn small had no prop for it, so every
 *     consuming app reached around the component and restyled it from outside.
 *     Three different dialects of that workaround existed in one repo.
 *
 * These pin the behaviour, not the numbers — they would still fail if someone
 * re-inlined a table, or re-coupled `size` to `level`, even with the same
 * defaults. The one place a literal size is asserted is the h1-vs-display case,
 * and only as an ordering.
 */
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Heading } from "../Heading";
import { HEADING_LEVELS, HEADING_SCALE } from "../../../../tokens/typography";
import type { HeadingLevel } from "../../../../tokens/typography";

/** Render in isolation and read the computed style back off the element. */
function drawn(node: React.ReactElement, label: string): CSSStyleDeclaration {
  const { unmount } = render(node);
  const style = globalThis.getComputedStyle(screen.getByText(label));
  const copy = { ...style, fontSize: style.fontSize, lineHeight: style.lineHeight };
  unmount();
  return copy as CSSStyleDeclaration;
}

const px = (value: string): number => Number.parseFloat(value) || 0;

describe("Heading — `level` is the rank, `size` is the scale step", () => {
  it("renders the tag `level` names, whatever size it is drawn at", () => {
    const { unmount } = render(
      <Heading level="h1" size="h6">
        page title
      </Heading>,
    );
    // The outline is what a screen reader walks. Shrinking a heading must not
    // demote it — that was the only way to get a small title before `size`.
    expect(screen.getByText("page title").tagName).toBe("H1");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    unmount();
  });

  it("draws `size`, not `level` — the two are independently settable", () => {
    const asH1 = drawn(<Heading level="h1">big</Heading>, "big");
    const asSmall = drawn(
      <Heading level="h1" size="h6">
        small
      </Heading>,
      "small",
    );
    expect(px(asSmall.fontSize)).toBeLessThan(px(asH1.fontSize));

    // …and the same size reached from a different rank draws identically, which
    // is the other half: `size` fully determines the metrics.
    const h6AsH6 = drawn(<Heading level="h6">plain</Heading>, "plain");
    expect(asSmall.fontSize).toBe(h6AsH6.fontSize);
  });

  it("defaults `size` to `level`, so calls written before it are untouched", () => {
    for (const level of HEADING_LEVELS) {
      const implicit = drawn(<Heading level={level}>{`implicit-${level}`}</Heading>, `implicit-${level}`);
      const explicit = drawn(
        <Heading level={level} size={level}>{`explicit-${level}`}</Heading>,
        `explicit-${level}`,
      );
      expect(implicit.fontSize, `${level} changed when size was passed explicitly`).toBe(
        explicit.fontSize,
      );
    }
  });
});

describe("Heading — the scale comes from the theme", () => {
  it("uses a host's `typography.headingScale` over the package default", () => {
    const theme = createTheme({ typography: { headingScale: { h1: { fontSize: "11px" } } } });
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <Heading level="h1">themed</Heading>
      </ThemeProvider>,
    );
    // The regression this replaces: the old table ignored the theme entirely, so
    // this assertion would have read the hardcoded 3rem no matter what.
    expect(globalThis.getComputedStyle(screen.getByText("themed")).fontSize).toBe("11px");
    unmount();
  });

  it("merges per METRIC, so overriding one does not drop the others", () => {
    const theme = createTheme({ typography: { headingScale: { h2: { fontSize: "13px" } } } });
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <Heading level="h2">partial</Heading>
      </ThemeProvider>,
    );
    const style = globalThis.getComputedStyle(screen.getByText("partial"));
    expect(style.fontSize).toBe("13px");
    // A host asking for a different size keeps the tracking the step was
    // designed with; a whole-step replace is how a partial override loses it.
    expect(style.letterSpacing).toBe(HEADING_SCALE.h2.letterSpacing);
    unmount();
  });

  it("falls back to the package scale for a step the host did not name", () => {
    const theme = createTheme({ typography: { headingScale: { h1: { fontSize: "11px" } } } });
    const { unmount } = render(
      <ThemeProvider theme={theme}>
        <Heading level="h3">untouched</Heading>
      </ThemeProvider>,
    );
    expect(globalThis.getComputedStyle(screen.getByText("untouched")).fontSize).toBe(
      HEADING_SCALE.h3.fontSize,
    );
    unmount();
  });
});

describe("Heading — the default scale is an application's, not a landing page's", () => {
  it("ramps monotonically from h6 up to display", () => {
    const order: HeadingLevel[] = ["h6", "h5", "h4", "h3", "h2", "h1", "display"];
    const sizes = order.map((level) => px(HEADING_SCALE[level].fontSize));
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i], `${order[i]} is not larger than ${order[i - 1]}`).toBeGreaterThan(
        sizes[i - 1] as number,
      );
    }
  });

  it("keeps the hero size on `display`, which is the step that asks for one", () => {
    // The old `h1` WAS the hero size (3rem), which is why reaching for a page
    // title got you one. `display` is where a caller says they want that.
    expect(px(HEADING_SCALE.display.fontSize)).toBeGreaterThan(px(HEADING_SCALE.h1.fontSize));
    // An h1 a product screen can actually use: at or under 2.5rem.
    expect(px(HEADING_SCALE.h1.fontSize)).toBeLessThanOrEqual(2.5);
  });

  it("gives every step in the vocabulary metrics — none can be missing", () => {
    for (const level of HEADING_LEVELS) {
      expect(HEADING_SCALE[level], `${level} has no metrics`).toBeTruthy();
      expect(HEADING_SCALE[level].fontSize).toMatch(/\d/);
    }
  });
});
