import { describe, expect, it } from 'vitest';

import { REPORT_GRID_COLUMNS, type PresentationShape } from '../../layout';
import { widthSegments } from '../block-width-picker';

/**
 * The width control offers a canonical few, but the SCHEMA accepts 1..12 on
 * purpose (`dashboardBlockSchema`). These cases pin the seam between those two
 * facts: the picker must never be the reason a stored width changes.
 *
 * WHICH few depends on the presentation (FUT-755) — a `Número` is a figure and
 * a caption, so a third of the canvas is mostly whitespace and its set runs
 * narrower.
 */
const KPI: PresentationShape = { kind: 'kpi' };
const BARS: PresentationShape = { kind: 'chart', chartType: 'bar' };
const TABLE: PresentationShape = { kind: 'table' };

describe('widthSegments — charts and tables', () => {
  it('offers the four canonical widths', () => {
    expect(widthSegments(6, BARS)).toEqual([
      { span: 4, label: '1/3' },
      { span: 6, label: '1/2' },
      { span: 8, label: '2/3' },
      { span: 12, label: '100%' },
    ]);
  });

  it.each([4, 6, 8, 12])('adds no extra segment for the canonical width %i', (span) => {
    expect(widthSegments(span, BARS)).toHaveLength(4);
  });

  it('keeps a non-canonical stored width as its own segment', () => {
    // A block saved at 5 — by a preset, over MCP, or by a future drag-resize —
    // must not be silently rewritten to 4 or 6 the moment its panel opens.
    const segments = widthSegments(5, BARS);
    expect(segments).toHaveLength(5);
    expect(segments.map((entry) => entry.span)).toEqual([4, 5, 6, 8, 12]);
    expect(segments.find((entry) => entry.span === 5)?.label).toBe('5/12');
  });

  it('places an odd width in grid order, not at the end', () => {
    // The row reads left-to-right as increasing width; appending would put a
    // narrow block after "100%".
    expect(widthSegments(2, BARS).map((entry) => entry.span)).toEqual([2, 4, 6, 8, 12]);
    expect(widthSegments(11, BARS).map((entry) => entry.span)).toEqual([4, 6, 8, 11, 12]);
  });

  it('offers a table the same four — the KPI set is the exception, not the rule', () => {
    expect(widthSegments(6, TABLE).map((entry) => entry.span)).toEqual([4, 6, 8, 12]);
  });
});

/**
 * `Número` needs SMALLER widths (FUT-755): "1/3 e 1/2 são grandes demais nesse
 * caso". A single figure in a third of the canvas is mostly whitespace.
 */
describe('widthSegments — Número runs narrower', () => {
  it('offers a sixth, a quarter, a third and a half', () => {
    expect(widthSegments(4, KPI)).toEqual([
      { span: 2, label: '1/6' },
      { span: 3, label: '1/4' },
      { span: 4, label: '1/3' },
      { span: 6, label: '1/2' },
    ]);
  });

  it('stops at a half — past that a KPI is a lonely number on a banner', () => {
    expect(widthSegments(4, KPI).map((entry) => entry.span)).not.toContain(8);
    expect(widthSegments(4, KPI).map((entry) => entry.span)).not.toContain(12);
  });

  it('keeps a KPI stored at the full canvas visible and selectable', () => {
    // Written by a preset, over MCP, or simply before the KPI set narrowed.
    // Dropping it from the control would make the block's own width invisible
    // in the control that represents it.
    const segments = widthSegments(REPORT_GRID_COLUMNS, KPI);
    expect(segments.map((entry) => entry.span)).toEqual([2, 3, 4, 6, 12]);
    expect(segments.at(-1)).toEqual({ span: 12, label: '100%' });
  });
});

/**
 * The labels are the whole point of item D: a segment that says `1/6` has to
 * BE a sixth. Twelfths can state 1/6, 1/4, 1/3, 1/2 and 2/3 exactly — and
 * cannot state 2/5 at all (4.8 columns), which is why no segment claims it.
 */
describe('widthSegments — a label never lies about the width it sets', () => {
  const EXACT: Record<string, number> = {
    '1/6': 1 / 6,
    '1/4': 1 / 4,
    '1/3': 1 / 3,
    '1/2': 1 / 2,
    '2/3': 2 / 3,
    '100%': 1,
  };

  it.each([KPI, BARS])('every named segment renders the fraction it names', (presentation) => {
    for (const segment of widthSegments(6, presentation)) {
      const named = EXACT[segment.label];
      // `n/12` is the honest fallback for a width with no simple name; the
      // named ones must be exact.
      if (named === undefined) {
        expect(segment.label).toBe(`${segment.span}/${REPORT_GRID_COLUMNS}`);
        continue;
      }
      expect(segment.span / REPORT_GRID_COLUMNS, segment.label).toBeCloseTo(named, 10);
    }
  });

  it('never offers 2/5 — the twelve-column grid cannot draw it', () => {
    // 2/5 is 4.8 columns. The nearest expressible width (5/12 = 0.4167) is 4%
    // off, so a segment labelled `2/5` would be a control lying about what it
    // does — the same defect class as a `1/3` block rendering full width.
    for (const presentation of [KPI, BARS, TABLE]) {
      expect(widthSegments(6, presentation).map((entry) => entry.label)).not.toContain('2/5');
    }
  });
});
