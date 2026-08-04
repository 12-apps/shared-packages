import { describe, expect, it } from 'vitest';

import { chartValueFormatter, formatChartValue } from '../chart-format';

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
