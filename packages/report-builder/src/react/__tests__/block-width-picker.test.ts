import { describe, expect, it } from 'vitest';

import { widthSegments } from '../block-width-picker';

/**
 * The width control offers four canonical widths, but the SCHEMA accepts 1..12
 * on purpose (`dashboardBlockSchema`). These cases pin the seam between those
 * two facts: the picker must never be the reason a stored width changes.
 */
describe('widthSegments', () => {
  it('offers the four canonical widths', () => {
    expect(widthSegments(6)).toEqual([
      { span: 4, label: '1/3' },
      { span: 6, label: '1/2' },
      { span: 8, label: '2/3' },
      { span: 12, label: 'Inteira' },
    ]);
  });

  it.each([4, 6, 8, 12])('adds no extra segment for the canonical width %i', (span) => {
    expect(widthSegments(span)).toHaveLength(4);
  });

  it('keeps a non-canonical stored width as its own segment', () => {
    // A block saved at 5 — by a preset, over MCP, or by a future drag-resize —
    // must not be silently rewritten to 4 or 6 the moment its panel opens.
    const segments = widthSegments(5);
    expect(segments).toHaveLength(5);
    expect(segments.map((entry) => entry.span)).toEqual([4, 5, 6, 8, 12]);
    expect(segments.find((entry) => entry.span === 5)?.label).toBe('5/12');
  });

  it('places an odd width in grid order, not at the end', () => {
    // The row reads left-to-right as increasing width; appending would put a
    // narrow block after "Inteira".
    expect(widthSegments(2).map((entry) => entry.span)).toEqual([2, 4, 6, 8, 12]);
    expect(widthSegments(11).map((entry) => entry.span)).toEqual([4, 6, 8, 11, 12]);
  });
});
