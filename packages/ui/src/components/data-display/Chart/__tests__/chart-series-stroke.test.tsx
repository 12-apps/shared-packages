import { createTheme } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Area, Bar, Line } from 'recharts';
import { describe, expect, it } from 'vitest';

import type { ChartProps } from '../Chart.types';
import { ChartLegendContent } from '../ChartComposables';
import { renderChartByType } from '../chart-renderers';

const theme = createTheme();
const data = [
  { name: 'Seg', now: 10, before: 8 },
  { name: 'Ter', now: 12, before: 9 },
];

/** The series elements a renderer produced, by their Recharts component. */
function seriesOf(props: ChartProps, component: unknown): Array<Record<string, unknown>> {
  const chart = renderChartByType(props, theme);
  const children = React.Children.toArray((chart.props as { children?: React.ReactNode }).children);
  return children
    .filter((child): child is React.ReactElement => React.isValidElement(child) && child.type === component)
    .map((child) => child.props as Record<string, unknown>);
}

describe('Chart series stroke (FUT-145)', () => {
  it('draws a line series dashed and at its declared width', () => {
    const [now, before] = seriesOf(
      {
        type: 'line',
        data,
        series: [
          { dataKey: 'now', name: 'Hoje' },
          { dataKey: 'before', name: 'Semana passada', strokeDasharray: '4 4', strokeWidth: 1.5 },
        ],
      },
      Line,
    );
    expect(now).toMatchObject({ strokeWidth: 2 });
    expect(now).not.toHaveProperty('strokeDasharray');
    expect(before).toMatchObject({ strokeWidth: 1.5, strokeDasharray: '4 4' });
  });

  it('honours dash, width and fill opacity on composed series', () => {
    const props: ChartProps = {
      type: 'composed',
      data,
      series: [
        { dataKey: 'now', type: 'area', fillOpacity: 0.2, strokeWidth: 3 },
        { dataKey: 'before', type: 'line', strokeDasharray: '6 3', strokeWidth: 2 },
        { dataKey: 'now', type: 'bar', fillOpacity: 0.5 },
      ],
    };
    const [area] = seriesOf(props, Area);
    const [line] = seriesOf(props, Line);
    const [bar] = seriesOf(props, Bar);
    expect(area).toMatchObject({ fillOpacity: 0.2, strokeWidth: 3 });
    expect(line).toMatchObject({ strokeDasharray: '6 3', strokeWidth: 2 });
    expect(bar).toMatchObject({ fillOpacity: 0.5 });
  });

  it('keeps an undeclared composed series exactly as before', () => {
    const props: ChartProps = {
      type: 'composed',
      data,
      series: [
        { dataKey: 'now', type: 'area' },
        { dataKey: 'before', type: 'line' },
        { dataKey: 'now', type: 'bar' },
      ],
    };
    const [area] = seriesOf(props, Area);
    const [line] = seriesOf(props, Line);
    const [bar] = seriesOf(props, Bar);
    expect(area).toMatchObject({ fillOpacity: 0.6 });
    // Not even an explicit `undefined`: it moves the renderer's own stroke-width
    // within the SVG element, and a host's golden would read that as a change.
    expect(area).not.toHaveProperty('strokeWidth');
    expect(line).not.toHaveProperty('strokeWidth');
    expect(line).not.toHaveProperty('strokeDasharray');
    expect(bar).not.toHaveProperty('fillOpacity');
  });

  it('honours dash and width on an area series', () => {
    const [area] = seriesOf(
      { type: 'area', data, series: [{ dataKey: 'before', strokeDasharray: '2 2', strokeWidth: 1 }] },
      Area,
    );
    expect(area).toMatchObject({ strokeDasharray: '2 2', strokeWidth: 1, fillOpacity: 0.6 });
  });

  it('draws a dashed series in the legend as a dashed rule, not a square', () => {
    render(
      <ChartLegendContent
        payload={[
          { value: 'Hoje', color: '#123456', payload: {} },
          { value: 'Semana passada', color: '#123456', payload: { strokeDasharray: '4 4' } },
        ]}
      />,
    );
    expect(screen.getByText('Hoje').previousElementSibling).not.toHaveAttribute('data-legend-dashed');
    expect(screen.getByText('Semana passada').previousElementSibling).toHaveAttribute('data-legend-dashed', 'true');
  });
});
