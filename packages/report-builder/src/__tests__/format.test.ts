import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import {
  formatDurationSeconds,
  formatKpiFigure,
  formatReportValue,
  SUPPRESSED_PLACEHOLDER,
} from '../format';
import { createMemoryDataSource } from '../memory';
import { runReport } from '../run';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { SUPPRESSED } from '../types';
import { salesCatalog } from './fixtures';

function compile(input: ReportSpecInput) {
  return compileReport(reportSpecSchema.parse(input), salesCatalog);
}

describe('formatDurationSeconds', () => {
  it('renders hours with minutes, dropping empty trailing units', () => {
    expect(formatDurationSeconds(5025)).toBe('1h 23m');
    expect(formatDurationSeconds(3600)).toBe('1h');
    expect(formatDurationSeconds(7260)).toBe('2h 1m');
  });

  it('renders sub-hour durations as minutes and seconds', () => {
    expect(formatDurationSeconds(750)).toBe('12m 30s');
    expect(formatDurationSeconds(120)).toBe('2m');
    expect(formatDurationSeconds(45)).toBe('45s');
    expect(formatDurationSeconds(0)).toBe('0s');
  });

  it('keeps the sign of a negative duration', () => {
    expect(formatDurationSeconds(-90)).toBe('-1m 30s');
  });

  it('rounds fractional seconds before splitting the units', () => {
    expect(formatDurationSeconds(59.6)).toBe('1m');
    expect(formatDurationSeconds(3599.7)).toBe('1h');
  });

  it('renders a non-finite duration as the placeholder', () => {
    expect(formatDurationSeconds(Number.NaN)).toBe(SUPPRESSED_PLACEHOLDER);
  });
});

describe('formatReportValue', () => {
  it('renders a percent measure from a 0-1 ratio, one decimal where meaningful', () => {
    expect(formatReportValue(0.84, 'percent', PT_BR_REPORT_ENGINE_COPY.values)).toBe('84%');
    expect(formatReportValue(0.8437, 'percent', PT_BR_REPORT_ENGINE_COPY.values)).toBe('84,4%');
    expect(formatReportValue(1, 'percent', PT_BR_REPORT_ENGINE_COPY.values)).toBe('100%');
    expect(formatReportValue(0.005, 'percent', PT_BR_REPORT_ENGINE_COPY.values)).toBe('0,5%');
  });

  it('renders a duration measure from seconds', () => {
    expect(formatReportValue(5025, 'duration', PT_BR_REPORT_ENGINE_COPY.values)).toBe('1h 23m');
  });

  it('keeps the existing money/integer/decimal/text semantics', () => {
    expect(formatReportValue(1234, 'brl', PT_BR_REPORT_ENGINE_COPY.values)).toBe(
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(12.34),
    );
    expect(formatReportValue(1234, 'integer', PT_BR_REPORT_ENGINE_COPY.values)).toBe('1.234');
    expect(formatReportValue(1.5, 'decimal', PT_BR_REPORT_ENGINE_COPY.values)).toBe('1,5');
    expect(formatReportValue('PIX', 'text', PT_BR_REPORT_ENGINE_COPY.values)).toBe('PIX');
    expect(formatReportValue(true, 'text', PT_BR_REPORT_ENGINE_COPY.values)).toBe('Sim');
  });

  it('renders null and the suppression marker as the same placeholder', () => {
    expect(formatReportValue(null, 'duration', PT_BR_REPORT_ENGINE_COPY.values)).toBe(SUPPRESSED_PLACEHOLDER);
    expect(formatReportValue(SUPPRESSED, 'duration', PT_BR_REPORT_ENGINE_COPY.values)).toBe(SUPPRESSED_PLACEHOLDER);
    expect(formatReportValue(SUPPRESSED, 'percent', PT_BR_REPORT_ENGINE_COPY.values)).toBe(SUPPRESSED_PLACEHOLDER);
  });
});

describe('formatKpiFigure', () => {
  it('formats the tile figure with the value formats plus compact', () => {
    expect(formatKpiFigure(0.84, 'percent')).toBe('84%');
    expect(formatKpiFigure(5025, 'duration')).toBe('1h 23m');
    expect(formatKpiFigure(null, 'duration')).toBe(SUPPRESSED_PLACEHOLDER);
    expect(formatKpiFigure(1500, 'compact')).toBe(
      new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(1500),
    );
  });
});

describe('compiled measure formats', () => {
  it('inherits the catalog field format', () => {
    const query = compile({
      entity: 'orders',
      measures: [{ field: 'prepSeconds', aggregation: 'p90' }],
    });
    expect(query.measures[0]?.format).toBe('duration');
  });

  it('lets the spec override the format per measure', () => {
    const query = compile({
      entity: 'orders',
      measures: [
        { field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount', format: 'percent' },
      ],
    });
    expect(query.measures[0]?.format).toBe('percent');
  });

  it('derives brl/decimal/integer from the field type when nothing declares a format', () => {
    const query = compile({
      entity: 'orders',
      measures: [
        { field: 'totalCents' },
        { field: 'itemCount', aggregation: 'avg' },
        { field: 'id', aggregation: 'count' },
      ],
    });
    expect(query.measures.map((measure) => measure.format)).toEqual(['brl', 'decimal', 'integer']);
  });
});

describe('render model format metadata', () => {
  const options = {
    catalog: salesCatalog,
    adapter: createMemoryDataSource({ orders: [] }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
    copy: PT_BR_REPORT_ENGINE_COPY,
  };

  it('carries the duration format on the table column', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90' }],
        presentation: { kind: 'table' },
      },
      options,
    );
    expect(result.render.kind).toBe('table');
    if (result.render.kind === 'table') {
      expect(result.render.columns.at(-1)).toEqual({
        key: 'p90',
        label: 'Tempo de preparo (p90)',
        format: 'duration',
      });
    }
  });

  it('marks a suppressed KPI tile without exposing the figure', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90', minSample: 5 }],
        presentation: { kind: 'kpi' },
      },
      {
        catalog: salesCatalog,
        adapter: createMemoryDataSource({ orders: [{ prepSeconds: 42 }] }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
        copy: PT_BR_REPORT_ENGINE_COPY,
      },
    );
    expect(result.render).toMatchObject({ kind: 'kpi', value: null, suppressed: true });
    expect(JSON.stringify(result.render)).not.toContain('42');
  });

  it('leaves an unsuppressed KPI tile unmarked', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        measures: [{ field: 'prepSeconds', aggregation: 'p90', alias: 'p90' }],
        presentation: { kind: 'kpi' },
      },
      {
        catalog: salesCatalog,
        adapter: createMemoryDataSource({ orders: [{ prepSeconds: 42 }] }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
        copy: PT_BR_REPORT_ENGINE_COPY,
      },
    );
    expect(result.render).toMatchObject({
      kind: 'kpi',
      value: 42,
      suppressed: false,
      format: 'duration',
    });
  });
});
