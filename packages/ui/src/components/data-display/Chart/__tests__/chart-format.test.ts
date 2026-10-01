import { describe, expect, it } from 'vitest';

import {
  chartAxisValueFormatter,
  chartValueFormatter,
  formatChartAxisValue,
  formatChartValue,
} from '../chart-format';

describe('formatChartValue', () => {
  it('formats brl from integer centavos', () => {
    const formatted = formatChartValue(123456, 'brl');
    expect(formatted).toContain('R$');
    expect(formatted).toContain('1.234,56');
  });

  it('formats negative centavos', () => {
    expect(formatChartValue(-500, 'brl')).toContain('5,00');
  });

  it('formats percent from a fraction', () => {
    expect(formatChartValue(0.153, 'percent')).toBe('15,3%');
  });

  it('formats compact values', () => {
    expect(formatChartValue(1500, 'compact')).toContain('1,5');
  });

  it('formats integers without decimals', () => {
    expect(formatChartValue(1234.56, 'integer')).toBe('1.235');
  });

  it('defaults to decimal formatting', () => {
    expect(formatChartValue(1234.567)).toBe('1.234,57');
  });

  it('renders non-finite values as an empty string', () => {
    expect(formatChartValue(Number.NaN, 'brl')).toBe('');
    expect(formatChartValue(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('chartValueFormatter', () => {
  it('curries the format', () => {
    const format = chartValueFormatter('brl');
    expect(format(100)).toContain('1,00');
  });
});

describe('formatChartAxisValue', () => {
  it('drops the centavos from a brl tick on a whole real', () => {
    expect(formatChartAxisValue(18000, 'brl')).toBe(formatChartValue(18000, 'brl').replace(',00', ''));
    expect(formatChartAxisValue(18000, 'brl')).not.toContain(',');
    expect(formatChartAxisValue(0, 'brl')).not.toContain(',');
  });

  it('keeps the centavos of a tick that falls between reais', () => {
    expect(formatChartAxisValue(250, 'brl')).toBe(formatChartValue(250, 'brl'));
  });

  it('formats every other format exactly as the tooltip does', () => {
    expect(formatChartAxisValue(0.153, 'percent')).toBe(formatChartValue(0.153, 'percent'));
    expect(formatChartAxisValue(1234.567)).toBe(formatChartValue(1234.567));
  });

  it('renders non-finite values as an empty string', () => {
    expect(formatChartAxisValue(Number.NaN, 'brl')).toBe('');
  });

  it('curries the format', () => {
    expect(chartAxisValueFormatter('brl')(4500)).not.toContain(',');
  });
});
