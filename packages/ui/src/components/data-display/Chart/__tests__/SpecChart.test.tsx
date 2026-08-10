import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { parseChartSpec } from '../chart-spec';
import { SpecChart } from '../SpecChart';

const json = JSON.stringify({
  type: 'bar',
  title: 'Vendas por dia',
  subtitle: 'Últimos 7 dias',
  xAxis: { key: 'day' },
  series: [
    { key: 'total', label: 'Total', color: 'primary' },
    { key: 'perdas', label: 'Perdas', color: 'danger' },
  ],
  numberFormat: 'brl',
});

const data = [
  { day: 'seg', total: 1200, perdas: 100 },
  { day: 'ter', total: 3400, perdas: 0 },
];

describe('SpecChart', () => {
  it('renders a chart from a pure JSON spec plus data rows', () => {
    render(<SpecChart spec={parseChartSpec(JSON.parse(json))} data={data} />);
    expect(screen.getByTestId('spec-chart')).toBeInTheDocument();
    expect(screen.getByText('Vendas por dia')).toBeInTheDocument();
    expect(screen.getByText('Últimos 7 dias')).toBeInTheDocument();
  });

  it('renders pie specs', () => {
    render(
      <SpecChart
        spec={parseChartSpec({
          type: 'pie',
          xAxis: { key: 'method' },
          series: [{ key: 'total' }],
        })}
        data={[
          { method: 'PIX', total: 700 },
          { method: 'Cartão', total: 300 },
        ]}
      />,
    );
    expect(screen.getByTestId('spec-chart')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    render(
      <SpecChart
        spec={parseChartSpec({ type: 'line', xAxis: { key: 'x' }, series: [{ key: 'y' }] })}
        data={[]}
        loading
      />,
    );
    expect(screen.getByTestId('spec-chart-loading')).toBeInTheDocument();
  });
});
