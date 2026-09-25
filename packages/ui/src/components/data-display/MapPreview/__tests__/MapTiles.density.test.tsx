import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { TILE_WORLD_UNITS } from "../mapProjection";
import { MapTiles } from "../MapTiles";

// `fontSize: 12` scales every design px by 12/14 — the density a compact host sets.
const theme = createTheme({ typography: { fontSize: 12 } });
const r = (px: number) => theme.typography.pxToRem(px);

function renderTiles() {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <MapTiles origin={{ x: 10, y: 20 }} zoom={12} mapType="roadmap" panOffset={{ x: 7, y: -3 }} />
    </ThemeProvider>,
  );
  const grid = container.firstElementChild as HTMLElement;
  return { grid, tile: grid.firstElementChild as HTMLElement };
}

describe("MapTiles under a non-default type scale", () => {
  it("draws the tile grid through the type scale, one design px per world unit", () => {
    const { grid, tile } = renderTiles();
    const tiles = grid.children.length;
    const perRow = Math.sqrt(tiles);

    expect(tile.style.width).toBe(r(TILE_WORLD_UNITS));
    expect(tile.style.height).toBe(r(TILE_WORLD_UNITS));
    expect(tile.style.fontSize).toBe(r(10));
    expect(grid.style.width).toBe(r(TILE_WORLD_UNITS * perRow));
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${perRow}, ${r(TILE_WORLD_UNITS)})`);
  });

  it("keeps the pan in pointer px, so the grid follows the cursor", () => {
    const { grid } = renderTiles();
    expect(grid.style.transform).toBe("translate(calc(-50% + 7px), calc(-50% + -3px))");
  });
});
