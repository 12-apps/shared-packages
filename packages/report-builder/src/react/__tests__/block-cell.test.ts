import { describe, expect, it } from 'vitest';

import { BLOCK_HEIGHT_MAX, blockHeightCss, REPORT_GRID_COLUMNS } from '../../layout';
import { BLOCK_FILL_BODY_SX, blockCellSx, spanBasis } from '../lib/block-cell';
import { GRID_GAP_PX } from '../lib/report-surface';

/**
 * THE BUG THIS SUITE EXISTS FOR (FUT-755): "não respeita a opção de resize que
 * eu selecionei. Só respeita se eu selecionar 2/3 no outro gráfico."
 *
 * A block set to `1/3` rendered FULL WIDTH and narrowed to a third only once a
 * sibling arrived to use the rest — because `flexGrow` was the block's span, so
 * a block alone on its row took the whole row. The canvas is flex, not CSS
 * grid, so the width is a computed `flex-basis` rather than a `grid-column`:
 * asserting that a prop was passed would prove nothing, and every case below
 * therefore resolves the basis to PIXELS against a concrete canvas.
 */

/** The canvas widths the cases below measure against. */
const CANVAS_PX = 1200;

/**
 * Resolve one `spanBasis` expression to pixels for a canvas of `containerPx`.
 *
 * It parses the exact shape `spanBasis` emits rather than evaluating arbitrary
 * CSS: a parse failure here means the arithmetic changed shape, which is
 * itself something this suite should notice.
 */
function resolveBasisPx(basis: string, containerPx: number): number {
  const match = /^calc\((\d+) \* \(100% - (\d+)px\) \/ (\d+) \+ (\d+)px - 0\.5px\)$/.exec(basis);
  if (match === null) throw new Error(`not a span basis: ${basis}`);
  const [span, gutters, columns, extra] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return (span * (containerPx - gutters)) / columns + extra - 0.5;
}

/** The per-tier basis the cell computes, read without loosening the types. */
function basisAt(sx: Record<string, unknown>, tier: 'xs' | 'sm' | 'lg'): string {
  const basis = sx.flexBasis;
  if (typeof basis !== 'object' || basis === null) {
    throw new Error('flexBasis is not a per-tier object');
  }
  const value = (basis as Record<string, unknown>)[tier];
  if (typeof value !== 'string') throw new Error(`no ${tier} basis`);
  return value;
}

describe('spanBasis — the grid’s own column arithmetic', () => {
  it('measures N columns plus the gutters between them', () => {
    const gutters = (REPORT_GRID_COLUMNS - 1) * GRID_GAP_PX;
    expect(spanBasis(4)).toBe(`calc(4 * (100% - ${gutters}px) / ${REPORT_GRID_COLUMNS} + 48px - 0.5px)`);
  });

  it('gives a full-canvas block the whole canvas, less the half-pixel of slack', () => {
    // The half pixel is deliberate and is the ONLY difference: it can make a
    // row fit but never wrap it early, and no display can draw it.
    expect(resolveBasisPx(spanBasis(REPORT_GRID_COLUMNS), CANVAS_PX)).toBe(CANVAS_PX - 0.5);
  });

  it('lands three 1/3 blocks and their two gutters on one canvas', () => {
    const third = resolveBasisPx(spanBasis(4), CANVAS_PX);
    expect(third * 3 + GRID_GAP_PX * 2).toBeLessThanOrEqual(CANVAS_PX);
    // …and only just: the shortfall is the deliberate half-pixel of slack per
    // block, which is below what a display can draw and far cheaper than a row
    // that wraps one block early.
    expect(third * 3 + GRID_GAP_PX * 2).toBeGreaterThan(CANVAS_PX - 2);
  });
});

describe('blockCellSx — a block never grows past the width it was given', () => {
  it('renders a lone 1/3 block as a THIRD, not as the whole row', () => {
    // The bug, stated as arithmetic: with `flexGrow: span` the only block on a
    // row absorbed all the leftover width and measured 1200px here.
    const third = resolveBasisPx(basisAt(blockCellSx(4), 'lg'), CANVAS_PX);
    expect(third).toBeGreaterThan(CANVAS_PX / 3 - 20);
    expect(third).toBeLessThan(CANVAS_PX / 3);
  });

  it('sets flexGrow to 0 at every span — closing the row is what overrode the author', () => {
    for (const span of [1, 2, 3, 4, 6, 8, 12]) {
      expect(blockCellSx(span).flexGrow, `span ${span}`).toBe(0);
    }
  });

  it('stays shrinkable, so a rounding overflow does not wrap the last block', () => {
    expect(blockCellSx(6).flexShrink).toBe(1);
  });

  it('gives every span its own basis rather than one shared stretch', () => {
    const widths = [2, 3, 4, 6, 8, 12].map((span) =>
      resolveBasisPx(basisAt(blockCellSx(span), 'lg'), CANVAS_PX),
    );
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(widths.length);
  });
});

/**
 * `responsiveSpan` is NOT that rule and must survive it: a third of a phone is
 * unreadable, so a block WIDENS by tier. That is a different span, honestly
 * rendered — not a block stretched past the one it was given.
 */
describe('blockCellSx — tier widening survives', () => {
  it('gives a 1/3 block the full width on a phone and half on a tablet', () => {
    const cell = blockCellSx(4);
    expect(resolveBasisPx(basisAt(cell, 'xs'), CANVAS_PX)).toBe(CANVAS_PX - 0.5);
    expect(basisAt(cell, 'sm')).toBe(spanBasis(6));
    expect(basisAt(cell, 'lg')).toBe(spanBasis(4));
  });

  it('widens a 1-column block to three on a phone rather than leaving it a twelfth', () => {
    expect(basisAt(blockCellSx(1), 'xs')).toBe(spanBasis(3));
  });

  it('never narrows a block below its authored span on a narrow tier', () => {
    for (let span = 1; span <= REPORT_GRID_COLUMNS; span += 1) {
      const cell = blockCellSx(span);
      const desktop = resolveBasisPx(basisAt(cell, 'lg'), CANVAS_PX);
      expect(resolveBasisPx(basisAt(cell, 'sm'), CANVAS_PX), `span ${span}`).toBeGreaterThanOrEqual(
        desktop,
      );
      expect(resolveBasisPx(basisAt(cell, 'xs'), CANVAS_PX), `span ${span}`).toBeGreaterThanOrEqual(
        resolveBasisPx(basisAt(cell, 'sm'), CANVAS_PX),
      );
    }
  });
});

/**
 * `Altura` (FUT-755). The compatibility requirement is the first case: a block
 * with no stored height must be sized by EXACTLY the rules it always was, and
 * that is asserted structurally — no height key at all — rather than by a value
 * that happens to agree.
 */
describe('blockCellSx — height', () => {
  it('adds nothing whatsoever when the block stores no height', () => {
    expect(Object.keys(blockCellSx(6)).sort()).toEqual([
      'flexBasis',
      'flexGrow',
      'flexShrink',
      'maxWidth',
      'minWidth',
    ]);
  });

  it('is byte-identical to the pre-height cell for every span', () => {
    for (let span = 1; span <= REPORT_GRID_COLUMNS; span += 1) {
      expect(blockCellSx(span, undefined), `span ${span}`).toEqual(blockCellSx(span));
    }
  });

  it('carries the tier’s own clamp, so the three are far enough apart to SEE', () => {
    for (const tier of [1, 2, 3]) {
      expect(blockCellSx(6, tier).minHeight, `tier ${tier}`).toBe(blockHeightCss(tier));
    }
    // …and the three are three different sizes, which is the complaint the
    // tiers were re-cut for: "alta and media almost change nothing".
    const drawn = [1, 2, 3].map((tier) => blockCellSx(6, tier).minHeight);
    expect(new Set(drawn).size).toBe(3);
  });

  it('applies the height as a MINIMUM — a long table outgrows it instead of clipping', () => {
    const cell = blockCellSx(6, 2);
    expect(cell.minHeight).toBeTruthy();
    expect(cell.height).toBeUndefined();
    expect(cell.maxHeight).toBeUndefined();
    expect(cell.overflow).toBeUndefined();
  });

  it('makes the block’s content fill the height rather than float at its top', () => {
    const cell = blockCellSx(6, BLOCK_HEIGHT_MAX);
    expect(cell.display).toBe('flex');
    expect(cell.flexDirection).toBe('column');
    // The cell's single child — the frame in the viewer, the focusable group in
    // the editor — grows into the space, whichever one it is.
    // `flex-basis: auto` keeps the child's own content as its FLOOR, so a
    // thirty-row table pushes the block taller instead of being squashed.
    expect(cell['& > *']).toEqual({
      flex: '1 1 auto',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    });
  });

  it('leaves the width rules untouched at every height', () => {
    for (const height of [1, 2, 3, BLOCK_HEIGHT_MAX]) {
      const cell = blockCellSx(4, height);
      expect(cell.flexGrow, `height ${height}`).toBe(0);
      expect(basisAt(cell, 'lg'), `height ${height}`).toBe(spanBasis(4));
    }
  });
});

/**
 * The fill chain, which is the half of `Altura` that is easy to get subtly
 * wrong: the height is only worth anything if every box between the cell and
 * the rendering passes it on.
 *
 * `flex-basis: 0` on the chart is a MAIN-axis size, so it is only a height
 * while every box above it is a `column`. One missing `flex-direction` and the
 * same declaration collapses the chart's WIDTH instead — which does not look
 * like a layout bug, it looks like a chart that lost its axis labels.
 */
describe('BLOCK_FILL_BODY_SX — the height has to reach the thing that draws', () => {
  const COLUMN = { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' };

  it('makes both levels between the body and the chart a flex column', () => {
    // One level is not enough: the render view's box holds the chart's own
    // box, which holds the responsive container.
    expect(BLOCK_FILL_BODY_SX['& > *']).toEqual(COLUMN);
    expect(BLOCK_FILL_BODY_SX['& > * > *']).toEqual(COLUMN);
  });

  it('is a column itself, so its children stack down the axis it sizes', () => {
    expect(BLOCK_FILL_BODY_SX.display).toBe('flex');
    expect(BLOCK_FILL_BODY_SX.flexDirection).toBe('column');
  });

  it('gives the chart the only zero basis — the one preset height to override', () => {
    expect(BLOCK_FILL_BODY_SX['& .recharts-responsive-container']).toEqual({
      flex: '1 1 0',
      minHeight: 0,
    });
  });
});
