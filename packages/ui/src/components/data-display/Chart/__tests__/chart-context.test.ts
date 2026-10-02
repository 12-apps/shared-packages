import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import type { ChartProps } from '../Chart.types';
import { buildChartContext } from '../chart-context';

const theme = createTheme();
const leftMargin = (props: Partial<ChartProps>): number | undefined =>
  buildChartContext({ data: [], ...props } as ChartProps, theme).commonProps.margin.left;

/**
 * The value axis of a line, bar, area or composed chart sizes itself to its
 * widest tick, so a left margin there was 20px of nothing — taken out of the
 * plot on a phone, where the plot was already the narrowest thing on the card.
 */
describe('buildChartContext — left margin', () => {
  it('gives an auto-width value axis no left margin', () => {
    for (const type of ['line', 'bar', 'area', 'composed'] as const) {
      expect(leftMargin({ type }), type).toBe(0);
    }
    expect(leftMargin({})).toBe(0);
  });

  it('keeps room for a rotated axis title', () => {
    expect(leftMargin({ type: 'line', yAxisLabel: 'Receita' })).toBeGreaterThan(0);
  });

  it('keeps the margin a pie is centred between, and scatter’s fixed-width axis', () => {
    expect(leftMargin({ type: 'pie' })).toBeGreaterThan(0);
    expect(leftMargin({ type: 'scatter' })).toBeGreaterThan(0);
    expect(leftMargin({ type: 'radar' })).toBeGreaterThan(0);
  });

  it('still lets the caller set it', () => {
    expect(leftMargin({ type: 'line', margin: { left: 8 } })).toBeGreaterThan(0);
  });
});
