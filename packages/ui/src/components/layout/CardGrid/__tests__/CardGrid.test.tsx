import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { CardGrid } from "../CardGrid";

// Every length is drawn through the theme's type scale; at MUI's defaults a
// design px `n` is `n / 16` rem, i.e. `n` px at a 16px root.

/** The rendered grid container's inline `grid-auto-columns` track sizing. */
function trackOf(children: number): string {
  const { unmount } = render(
    <CardGrid variant="scroll" cardWidth={165} maxCardWidth={190} gridTestId="rail">
      {Array.from({ length: children }, (_, i) => (
        <div key={i}>card {i}</div>
      ))}
    </CardGrid>,
  );
  const track = screen.getByTestId("rail").style.gridAutoColumns;
  unmount();
  return track;
}

describe("CardGrid scroll variant", () => {
  it("sizes tracks so two cards plus a peek of the third always fit", () => {
    // 2 cards + the 2 gaps that follow them + the 28px peek = the container:
    // 190 and 60 design px.
    expect(trackOf(3)).toBe("min(11.875rem, calc((100% - 3.75rem) / 2))");
  });

  it("keeps the peek at every rail length past the fold", () => {
    expect(trackOf(7)).toBe(trackOf(3));
  });

  it("reserves no peek when there is nothing to scroll to", () => {
    // Two cards: no overflow, so no "there's more" hint to make room for —
    // they divide the row across the single gap between them.
    expect(trackOf(2)).toBe("min(11.875rem, calc((100% - 1rem) / 2))");
    expect(trackOf(1)).toBe("min(11.875rem, calc((100% - 0rem) / 1))");
  });

  it("never floors the track at cardWidth — a floor would swallow the peek", () => {
    // The narrow-phone guarantee only holds if the track can shrink below the
    // nominal card width; a `min-width` is exactly what broke it before.
    // 165 design px.
    expect(trackOf(5)).not.toContain("10.3125rem");
  });

  it("defaults maxCardWidth to 1.6 × cardWidth", () => {
    render(
      <CardGrid variant="scroll" cardWidth={100} gridTestId="default-max">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </CardGrid>,
    );
    // 160 design px.
    expect(screen.getByTestId("default-max").style.gridAutoColumns).toContain("min(10rem,");
  });

  it("scrolls horizontally and snaps each card to the rail start", () => {
    render(
      <CardGrid variant="scroll" cardWidth={165} gridTestId="snap">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </CardGrid>,
    );
    const rail = screen.getByTestId("snap");
    expect(rail.style.overflowX).toBe("auto");
    expect(rail.style.scrollSnapType).toBe("x mandatory");
    expect(rail.children).toHaveLength(3);
    for (const child of rail.children) {
      expect((child as HTMLElement).style.scrollSnapAlign).toBe("start");
    }
  });
});

describe("CardGrid wrapping variants", () => {
  it("leaves the fluid and fixed track math untouched", () => {
    render(
      <CardGrid variant="fluid" cardWidth={165} gridTestId="fluid">
        <div>a</div>
      </CardGrid>,
    );
    render(
      <CardGrid variant="fixed" cardWidth={230} gridTestId="fixed">
        <div>a</div>
      </CardGrid>,
    );
    expect(screen.getByTestId("fluid").style.gridTemplateColumns).toBe(
      "repeat(auto-fill, minmax(10.3125rem, 1fr))",
    );
    expect(screen.getByTestId("fixed").style.gridTemplateColumns).toBe(
      "repeat(auto-fill, 14.375rem)",
    );
    expect(screen.getByTestId("fixed").style.justifyContent).toBe("space-around");
  });
});

describe("CardGrid under a non-default type scale", () => {
  // `fontSize: 12` scales every design px by 12/14 — the density a compact host sets.
  const theme = createTheme({ typography: { fontSize: 12 } });
  const r = (px: number) => theme.typography.pxToRem(px);

  it("scales the gap it lays out with and the gap the scroll math reserves together", () => {
    render(
      <ThemeProvider theme={theme}>
        <CardGrid variant="scroll" cardWidth={165} maxCardWidth={190} gridTestId="dense">
          <div>a</div>
          <div>b</div>
          <div>c</div>
        </CardGrid>
      </ThemeProvider>,
    );
    const rail = screen.getByTestId("dense");
    expect(rail.style.gap).toBe(r(16));
    expect(rail.style.paddingBottom).toBe(r(2));
    // 2 gaps + the 28 design px peek, reserved in the same scale as the gap itself.
    expect(rail.style.gridAutoColumns).toBe(`min(${r(190)}, calc((100% - ${r(60)}) / 2))`);
  });

  it("scales the card width a consumer passes in", () => {
    render(
      <ThemeProvider theme={theme}>
        <CardGrid variant="fixed" cardWidth={230} gridTestId="dense-fixed">
          <div>a</div>
        </CardGrid>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("dense-fixed").style.gridTemplateColumns).toBe(
      `repeat(auto-fill, ${r(230)})`,
    );
  });
});
