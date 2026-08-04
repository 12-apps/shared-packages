import { describe, expect, it } from 'vitest';

import { describeSpecIssues, reportSpecSchema } from '../spec';

const minimal = {
  entity: 'orders',
  measures: [{ field: 'totalCents' }],
};

describe('reportSpecSchema', () => {
  it('applies defaults (version, dimensions, filters, sort, presentation)', () => {
    const spec = reportSpecSchema.parse(minimal);
    expect(spec.version).toBe(1);
    expect(spec.dimensions).toEqual([]);
    expect(spec.filters).toEqual([]);
    expect(spec.sort).toEqual([]);
    expect(spec.presentation).toEqual({ kind: 'table' });
  });

  it('rejects unknown versions', () => {
    expect(reportSpecSchema.safeParse({ ...minimal, version: 2 }).success).toBe(false);
  });

  it('requires at least one measure', () => {
    expect(reportSpecSchema.safeParse({ entity: 'orders', measures: [] }).success).toBe(false);
  });

  it('caps dimensions at 2', () => {
    const result = reportSpecSchema.safeParse({
      ...minimal,
      dimensions: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
    });
    expect(result.success).toBe(false);
  });

  it('enforces filter operator payloads', () => {
    expect(
      reportSpecSchema.safeParse({
        ...minimal,
        filters: [{ field: 'method', operator: 'in' }],
      }).success,
    ).toBe(false);
    expect(
      reportSpecSchema.safeParse({
        ...minimal,
        filters: [{ field: 'createdAt', operator: 'between', from: '2026-07-01' }],
      }).success,
    ).toBe(false);
    expect(
      reportSpecSchema.safeParse({
        ...minimal,
        filters: [{ field: 'method', operator: 'eq', value: 'PIX' }],
      }).success,
    ).toBe(true);
  });

  it('rejects malformed aliases', () => {
    expect(
      reportSpecSchema.safeParse({
        ...minimal,
        measures: [{ field: 'totalCents', alias: 'no spaces' }],
      }).success,
    ).toBe(false);
  });

  it('describes issues with paths for LLM self-correction', () => {
    const result = reportSpecSchema.safeParse({ entity: '', measures: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = describeSpecIssues(result.error);
      expect(message).toContain('entity');
      expect(message).toContain('measures');
    }
  });
});
