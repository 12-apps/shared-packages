import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardGrid } from "../CardGrid";

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
    // 2 cards + the 2 gaps that follow them + the 28px peek = the container.
    expect(trackOf(3)).toBe("min(190px, calc((100% - 60px) / 2))");
  });

  it("keeps the peek at every rail length past the fold", () => {
    expect(trackOf(7)).toBe(trackOf(3));
  });

  it("reserves no peek when there is nothing to scroll to", () => {
    // Two cards: no overflow, so no "there's more" hint to make room for —
    // they divide the row across the single gap between them.
    expect(trackOf(2)).toBe("min(190px, calc((100% - 16px) / 2))");
    expect(trackOf(1)).toBe("min(190px, calc((100% - 0px) / 1))");
  });

  it("never floors the track at cardWidth — a floor would swallow the peek", () => {
    // The narrow-phone guarantee only holds if the track can shrink below the
    // nominal card width; a `min-width` is exactly what broke it before.
    expect(trackOf(5)).not.toContain("165px");
  });

  it("defaults maxCardWidth to 1.6 × cardWidth", () => {
    render(
      <CardGrid variant="scroll" cardWidth={100} gridTestId="default-max">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </CardGrid>,
    );
    expect(screen.getByTestId("default-max").style.gridAutoColumns).toContain("160px");
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
      "repeat(auto-fill, minmax(165px, 1fr))",
    );
    expect(screen.getByTestId("fixed").style.gridTemplateColumns).toBe(
      "repeat(auto-fill, 230px)",
    );
    expect(screen.getByTestId("fixed").style.justifyContent).toBe("space-around");
  });
});
