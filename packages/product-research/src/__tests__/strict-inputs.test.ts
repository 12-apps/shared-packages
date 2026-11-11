/**
 * The request schemas refuse a key they do not declare, at every depth
 * (FUT-4729) — an extra key is a caller to fix, never a field to drop.
 */
import { describe, expect, it } from 'vitest';

import {
  addManualQuoteBody,
  importManualPricesBody,
  listManualPricesQuery,
  researchSourceParams,
  startResearchSchema,
} from '../schemas';

describe('the research request inputs are strict', () => {
  it('refuses an unknown key on the start body, the query and the catalog ref', () => {
    const query = { term: 'cafe', quantity: 1 };
    expect(startResearchSchema.safeParse({ query }).success).toBe(true);
    expect(startResearchSchema.safeParse({ query, tenantId: 'x' }).success).toBe(false);
    expect(startResearchSchema.safeParse({ query: { ...query, sku: 'x' } }).success).toBe(false);
    expect(
      startResearchSchema.safeParse({ query, catalogRef: { type: 'a', id: 'b', extra: 1 } }).success,
    ).toBe(false);
  });

  it('refuses an unknown key on the import body, its csv, its mapping and its rows', () => {
    const row = { title: 'Cafe 500g', price: '12,90' };
    const csv = { content: 'a;b' };
    expect(importManualPricesBody.safeParse({ rows: [row] }).success).toBe(true);
    expect(importManualPricesBody.safeParse({ rows: [row], extra: 1 }).success).toBe(false);
    expect(importManualPricesBody.safeParse({ rows: [{ ...row, sku: 'x' }] }).success).toBe(false);
    expect(importManualPricesBody.safeParse({ csv: { ...csv, quote: '"' } }).success).toBe(false);
    expect(importManualPricesBody.safeParse({ csv: { ...csv, mapping: { sku: 'A' } } }).success).toBe(false);
    expect(addManualQuoteBody.safeParse({ ...row, note: 'x' }).success).toBe(false);
  });

  it('refuses an unknown query or path key', () => {
    expect(listManualPricesQuery.safeParse({ page: '2', sort: 'x' }).success).toBe(false);
    expect(researchSourceParams.safeParse({ tenantSlug: 't', sourceId: 's', x: 1 }).success).toBe(false);
  });
});
