import { describe, expect, it } from 'vitest';

import { listCatalogFields } from '../catalog';
import { defaultValueFor, isClosedSet, isMultiValue, operatorsFor } from '../filters';
import type { FieldDef } from '../types';

/**
 * FUT-391: what a field may be filtered BY, and what it may be filtered TO.
 * The builder reads both off the catalog, so these rules decide whether
 * "status igual a Pago" is a picker or a text box the author can mistype.
 */

const field = (patch: Partial<FieldDef>): FieldDef => ({
  label: 'Campo',
  type: 'string',
  role: 'dimension',
  ...patch,
});

describe('operatorsFor', () => {
  it('offers a closed set only the operators that make sense on one', () => {
    // Ordering enum CODES is meaningless even when it runs, so no gte/lte.
    expect(
      operatorsFor(field({ values: [{ value: 'PAID', label: 'Pago' }] })),
    ).toEqual(['eq', 'neq', 'in']);
  });

  it('offers ranges on numbers and dates, not equality alone', () => {
    expect(operatorsFor(field({ type: 'money', role: 'measure' }))).toContain('between');
    expect(operatorsFor(field({ type: 'date' }))).toEqual(['gte', 'lte', 'between']);
  });

  it('lets a catalog NARROW the defaults', () => {
    expect(operatorsFor(field({ type: 'money', ops: ['gte'] }))).toEqual(['gte']);
  });

  it("prefers the catalog's own ops over the closed-set rule", () => {
    const declared = field({ values: [{ value: 'A', label: 'A' }], ops: ['eq'] });
    expect(operatorsFor(declared)).toEqual(['eq']);
  });

  it('falls back to equality on a boolean', () => {
    expect(operatorsFor(field({ type: 'boolean' }))).toEqual(['eq', 'neq']);
  });
});

describe('isClosedSet / defaultValueFor', () => {
  it('treats a field with values as picked, and defaults to its first', () => {
    const status = field({
      values: [
        { value: 'PAID', label: 'Pago' },
        { value: 'FAILED', label: 'Falhou' },
      ],
    });
    expect(isClosedSet(status)).toBe(true);
    expect(defaultValueFor(status)).toBe('PAID');
  });

  it('treats a field without values as typed, defaulting to blank', () => {
    expect(isClosedSet(field({}))).toBe(false);
    expect(defaultValueFor(field({}))).toBe('');
  });

  it('does not treat an EMPTY values list as a closed set', () => {
    // A catalog that computed its options and found none must fall back to a
    // text box, not render a picker with nothing in it.
    expect(isClosedSet(field({ values: [] }))).toBe(false);
    expect(operatorsFor(field({ values: [] }))).toEqual(['eq', 'neq', 'in']);
  });
});

describe('isMultiValue', () => {
  it('marks only `in` as taking a list', () => {
    expect(isMultiValue('in')).toBe(true);
    expect(isMultiValue('eq')).toBe(false);
    // `between` takes two operands, but through from/to rather than a list.
    expect(isMultiValue('between')).toBe(false);
  });
});

describe('listCatalogFields', () => {
  it('ships values and RESOLVED ops, so a client never re-derives them', () => {
    const listing = listCatalogFields({
      entities: {
        orders: {
          label: 'Pedidos',
          fields: {
            status: {
              label: 'Status',
              type: 'string',
              role: 'dimension',
              values: [{ value: 'PAID', label: 'Pago' }],
            },
            total: { label: 'Total', type: 'money', role: 'measure' },
          },
        },
      },
    });

    const fields = listing.entities[0]?.fields ?? [];
    const status = fields.find((entry) => entry.field === 'status');
    const total = fields.find((entry) => entry.field === 'total');

    expect(status?.values).toEqual([{ value: 'PAID', label: 'Pago' }]);
    expect(status?.ops).toEqual(['eq', 'neq', 'in']);
    // Resolved for EVERY field, not only declared ones — that is what stops a
    // client from keeping its own copy of the defaults and drifting.
    expect(total?.values).toBeUndefined();
    expect(total?.ops).toEqual(['eq', 'neq', 'gte', 'lte', 'between']);
  });
});
