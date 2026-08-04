import { describe, expect, it } from 'vitest';

import type { ChartSpec } from '../ChartSpec.types';
import { ChartSpecError, parseChartSpec, specToChartProps } from '../chart-spec';
import {
  getRegisteredChartSpecTypes,
  registerChartSpecRenderer,
  type ChartSpecRenderContext,
} from '../chart-spec-registry';

const ctx: ChartSpecRenderContext = {
  resolveColor: (token, index) => `${token ?? 'auto'}-${index}`,
};

const lineSpec: ChartSpec = {
  type: 'line',
  title: 'Vendas',
  xAxis: { key: 'day' },
  series: [{ key: 'total', label: 'Total', color: 'primary' }, { key: 'count' }],
  numberFormat: 'brl',
};

describe('parseChartSpec', () => {
  it('accepts a valid spec round-tripped through JSON', () => {
    const parsed = parseChartSpec(JSON.parse(JSON.stringify(lineSpec)));
    expect(parsed.type).toBe('line');
    expect(parsed.series).toHaveLength(2);
    expect(parsed.xAxis.key).toBe('day');
  });

  it('rejects non-objects', () => {
    expect(() => parseChartSpec('nope')).toThrow(ChartSpecError);
  });

  it('rejects unknown chart types and lists registered ones', () => {
    expect(() => parseChartSpec({ ...lineSpec, type: 'sankey' })).toThrow(/registered chart types/);
    expect(() => parseChartSpec({ ...lineSpec, type: 'sankey' })).toThrow(/line/);
  });

  it('rejects a missing xAxis key', () => {
    expect(() => parseChartSpec({ ...lineSpec, xAxis: {} })).toThrow(/"xAxis"/);
  });

  it('rejects empty series', () => {
    expect(() => parseChartSpec({ ...lineSpec, series: [] })).toThrow(/"series"/);
  });

  it('rejects raw color values with an actionable message', () => {
    expect(() => parseChartSpec({ ...lineSpec, series: [{ key: 'total', color: '#ff0000' }] })).toThrow(
      /semantic color token/,
    );
  });

  it('rejects invalid number formats', () => {
    expect(() => parseChartSpec({ ...lineSpec, numberFormat: 'usd' })).toThrow(/"numberFormat"/);
  });

  it('rejects invalid colorScheme entries', () => {
    expect(() => parseChartSpec({ ...lineSpec, colorScheme: ['primary', 'magenta'] })).toThrow(
      /"colorScheme\[1\]"/,
    );
  });
});

describe('specToChartProps', () => {
  it('maps cartesian specs onto Chart props', () => {
    const props = specToChartProps(lineSpec, [{ day: 'seg', total: 100, count: 2 }], ctx);
    expect(props.type).toBe('line');
    expect(props.xAxisKey).toBe('day');
    expect(props.series).toEqual([
      { dataKey: 'total', name: 'Total', color: 'primary-0' },
      { dataKey: 'count', name: 'count', color: 'auto-1' },
    ]);
    expect(props.valueFormatter?.(100)).toContain('1,00');
  });

  it('honors stacked bars and legend/tooltip toggles', () => {
    const props = specToChartProps(
      { ...lineSpec, type: 'bar', stacked: true, legend: false, tooltip: false },
      [],
      ctx,
    );
    expect(props.type).toBe('bar');
    expect(props.stacked).toBe(true);
    expect(props.showLegend).toBe(false);
    expect(props.showTooltip).toBe(false);
  });

  it('renders donut as pie with an inner radius and center label', () => {
    const props = specToChartProps(
      {
        type: 'donut',
        xAxis: { key: 'method' },
        series: [{ key: 'total' }],
        centerLabel: { label: 'Total', value: 'R$ 10' },
      },
      [],
      ctx,
    );
    expect(props.type).toBe('pie');
    expect(props.innerRadius).toBeGreaterThan(0);
    expect(props.centerLabel).toEqual({ label: 'Total', value: 'R$ 10' });
  });

  it('supports registering new chart types without touching consumers', () => {
    registerChartSpecRenderer('sparkline', (spec) => ({
      type: 'line',
      series: spec.series.map((s) => ({ dataKey: s.key })),
    }));
    expect(getRegisteredChartSpecTypes()).toContain('sparkline');
    const spec = parseChartSpec({
      type: 'sparkline',
      xAxis: { key: 'x' },
      series: [{ key: 'y' }],
    });
    const props = specToChartProps(spec, [], ctx);
    expect(props.type).toBe('line');
  });
});
