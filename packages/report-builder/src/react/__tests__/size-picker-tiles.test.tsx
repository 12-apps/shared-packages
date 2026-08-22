// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { renderWithCopy as render } from './with-copy';

import type { PresentationShape } from '../../layout';
import { BlockHeightPicker } from '../block-height-picker';
import { BlockWidthPicker } from '../block-width-picker';
import {
  SIZE_TILE_HEIGHT_PX,
  SIZE_TILE_MIN_WIDTH_PX } from '../lib/size-picker-tile';

/**
 * EVERY OPTION TILE IS THE SAME SIZE, in both size pickers (FUT-755): "all
 * squares here should have the same size. same here".
 *
 * Both controls used to be a wrapping row of buttons, so a tile was as wide as
 * its own label — the full-canvas option bigger than `1/3`, `Alta` smaller than
 * the auto option — and `Altura` wrapped 3-then-1 with the orphan narrower than
 * the three above it. Options of one property that render at different sizes
 * read as options of different KINDS.
 *
 * jsdom performs no layout, so a rendered pixel width is not available to
 * assert on. What IS available, and is the thing that actually decides the
 * question, is the rule each tile carries: one column of a grid whose columns
 * are all `1fr`, at one fixed height. Equal columns plus an equal height is
 * equal tiles, whatever the container resolves to.
 */
const KPI: PresentationShape = { kind: 'kpi' };
const BARS: PresentationShape = { kind: 'chart', chartType: 'bar' };

afterEach(cleanup);

/** Every option tile in a picker, found by the picker's own container id. */
function tilesOf(testId: string): HTMLElement[] {
  return within(screen.getByTestId(testId)).getAllByRole('button');
}

function renderWidth(span: number, presentation: PresentationShape): void {
  render(
    <BlockWidthPicker
      span={span}
      presentation={presentation}
      onChange={() => undefined}
      testId="w"
    />,
  );
}

function renderHeight(height: number | undefined): void {
  render(
    <BlockHeightPicker height={height} onChange={() => undefined} testId="h" />,
  );
}

describe('Largura — one size for every option tile', () => {
  it('gives all four tiles the same width rule and the same height', () => {
    renderWidth(6, BARS);
    const tiles = tilesOf('w');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      const style = window.getComputedStyle(tile);
      // The full-canvas option had the longest label and the widest tile.
      expect(style.width, tile.textContent ?? '').toBe('100%');
      expect(style.height, tile.textContent ?? '').toBe(`${SIZE_TILE_HEIGHT_PX}px`);
    }
  });

  it('sizes the KPI set identically too — 1/6 is no smaller than 1/2', () => {
    renderWidth(4, KPI);
    const tiles = tilesOf('w');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(window.getComputedStyle(tile).height, tile.textContent ?? '').toBe(
        `${SIZE_TILE_HEIGHT_PX}px`,
      );
    }
  });

  it('sizes a non-canonical stored width like the rest, not as an odd fifth', () => {
    renderWidth(5, BARS);
    const tiles = tilesOf('w');
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) {
      expect(window.getComputedStyle(tile).height, tile.textContent ?? '').toBe(
        `${SIZE_TILE_HEIGHT_PX}px`,
      );
    }
  });

  it('lays the tiles out as equal columns rather than a label-width row', () => {
    renderWidth(6, BARS);
    const columns = window.getComputedStyle(screen.getByTestId('w')).gridTemplateColumns;
    expect(columns).toContain('1fr');
    // The floor is a WIDTH, so the longest label always fits: below it the grid
    // drops a column and the tiles grow rather than clipping.
    expect(columns).toContain(`${SIZE_TILE_MIN_WIDTH_PX}px`);
  });
});

describe('Altura — the same one size, and the same as Largura’s', () => {
  it('gives Auto, Baixa, Média and Alta one width rule and one height', () => {
    renderHeight(undefined);
    const tiles = tilesOf('h');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      const style = window.getComputedStyle(tile);
      // Every label here is one short word, which is what lets the shared
      // column floor be genuinely compact instead of sized to one outlier.
      expect(style.width, tile.textContent ?? '').toBe('100%');
      expect(style.height, tile.textContent ?? '').toBe(`${SIZE_TILE_HEIGHT_PX}px`);
    }
  });

  it('sizes the selected tile exactly like the rest', () => {
    // The selected option is a `solid` button and the others `outline`; a
    // variant must not change the box, or the set stops reading as one control.
    renderHeight(2);
    const tiles = tilesOf('h');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      const style = window.getComputedStyle(tile);
      expect(style.width, tile.textContent ?? '').toBe('100%');
      expect(style.height, tile.textContent ?? '').toBe(`${SIZE_TILE_HEIGHT_PX}px`);
    }
  });

  it('uses the same column rule as Largura, so the two pickers match each other', () => {
    renderWidth(6, BARS);
    renderHeight(undefined);
    expect(window.getComputedStyle(screen.getByTestId('h')).gridTemplateColumns).toBe(
      window.getComputedStyle(screen.getByTestId('w')).gridTemplateColumns,
    );
  });

  it('keeps the tallest preview bar inside the tile, label and all', () => {
    // The bar scales with the tier; without a ceiling tied to the tile the
    // tallest one would push its own label out of a fixed-height box.
    renderHeight(3);
    const tallest = within(screen.getByTestId('h')).getByTestId('h-3');
    const bar = tallest.querySelector('div');
    const barHeight = bar === null ? 0 : Number.parseFloat(window.getComputedStyle(bar).height);
    expect(barHeight).toBeGreaterThan(0);
    expect(barHeight).toBeLessThan(SIZE_TILE_HEIGHT_PX);
  });

  it('draws a taller bar for each taller tier, so the tiles read as a scale', () => {
    renderHeight(undefined);
    const group = within(screen.getByTestId('h'));
    const barPx = (testId: string): number => {
      const bar = group.getByTestId(testId).querySelector('div');
      return bar === null ? 0 : Number.parseFloat(window.getComputedStyle(bar).height);
    };
    expect(barPx('h-1')).toBeLessThan(barPx('h-2'));
    expect(barPx('h-2')).toBeLessThan(barPx('h-3'));
  });
});
