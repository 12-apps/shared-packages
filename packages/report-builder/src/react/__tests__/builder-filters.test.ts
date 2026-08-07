import { describe, expect, it } from 'vitest';

import {
  defaultValueFor,
  editFilterRow,
  operatorOptionsFor,
  valueOptionsFor,
} from '../builder-filters';
import type { BuilderDraft } from '../builder-model';
import type { ReportField } from '../custom-reports-api';

/**
 * The filter row's half of FUT-391. The server decides what is legal; this
 * layer decides what the BUILDER can currently express, and keeps a row
 * internally consistent when its field changes.
 */

const STATUS: ReportField = {
  field: 'status',
  label: 'Status',
  type: 'string',
  role: 'dimension',
  values: [
    { value: 'PAID', label: 'Pago' },
    { value: 'FAILED', label: 'Falhou' },
  ],
  ops: ['eq', 'neq', 'in'],
};

const TOTAL: ReportField = {
  field: 'total',
  label: 'Total',
  type: 'money',
  role: 'measure',
  ops: ['eq', 'neq', 'gte', 'lte', 'between'],
};

const FIELDS = new Map<string, ReportField>([
  ['status', STATUS],
  ['total', TOTAL],
]);

const draftWith = (filters: BuilderDraft['filters']): BuilderDraft =>
  ({ filters }) as BuilderDraft;

describe('operatorOptionsFor', () => {
  it('drops operators the draft cannot serialize', () => {
    // `in` needs values[] and `between` needs from/to; specFromDraft writes a
    // single `value`, so offering either would emit a spec the schema rejects.
    expect(operatorOptionsFor(STATUS)).toEqual(['eq', 'neq']);
    expect(operatorOptionsFor(TOTAL)).toEqual(['eq', 'neq', 'gte', 'lte']);
  });

  it('never returns an empty list', () => {
    const inOnly: ReportField = { ...STATUS, ops: ['in'] };
    expect(operatorOptionsFor(inOnly)).toEqual(['eq']);
  });

  it('falls back to the full single-value set for a field listing with no ops', () => {
    const legacy: ReportField = { field: 'x', label: 'X', type: 'string', role: 'dimension' };
    expect(operatorOptionsFor(legacy)).toEqual(['eq', 'neq', 'gte', 'lte']);
  });
});

describe('valueOptionsFor / defaultValueFor', () => {
  it('returns a picker for a closed set and null for a typed field', () => {
    expect(valueOptionsFor(STATUS)).toEqual([
      { value: 'PAID', label: 'Pago' },
      { value: 'FAILED', label: 'Falhou' },
    ]);
    expect(valueOptionsFor(TOTAL)).toBeNull();
  });

  it('defaults to the first legal value, or blank when typed', () => {
    expect(defaultValueFor(STATUS)).toBe('PAID');
    expect(defaultValueFor(TOTAL)).toBe('');
  });
});

describe('editFilterRow', () => {
  it('resets operator and value when the FIELD changes', () => {
    // The bug this prevents: keeping `1500` behind after switching to status
    // yields `status eq 1500` — valid JSON, compiles, matches nothing.
    const draft = draftWith([{ field: 'total', operator: 'gte', value: '1500' }]);
    expect(editFilterRow(draft, 0, { field: 'status' }, FIELDS)).toEqual([
      { field: 'status', operator: 'eq', value: 'PAID' },
    ]);
  });

  it('leaves the value alone when only the operator changes', () => {
    const draft = draftWith([{ field: 'status', operator: 'eq', value: 'FAILED' }]);
    expect(editFilterRow(draft, 0, { operator: 'neq' }, FIELDS)).toEqual([
      { field: 'status', operator: 'neq', value: 'FAILED' },
    ]);
  });

  it('snaps an operator the field no longer offers back to a legal one', () => {
    // A stored spec can carry `gte` on a status; rendering a Select whose value
    // matches no option shows blank and reads as a broken control.
    const draft = draftWith([{ field: 'status', operator: 'gte', value: 'PAID' }]);
    expect(editFilterRow(draft, 0, { value: 'FAILED' }, FIELDS)).toEqual([
      { field: 'status', operator: 'eq', value: 'FAILED' },
    ]);
  });

  it('is a no-op for an index that does not exist', () => {
    const draft = draftWith([{ field: 'status', operator: 'eq', value: 'PAID' }]);
    expect(editFilterRow(draft, 5, { value: 'X' }, FIELDS)).toEqual(draft.filters);
  });

  it('does not mutate the draft it was given', () => {
    const filters = [{ field: 'total', operator: 'gte', value: '1500' }];
    const draft = draftWith(filters);
    editFilterRow(draft, 0, { field: 'status' }, FIELDS);
    expect(filters).toEqual([{ field: 'total', operator: 'gte', value: '1500' }]);
  });
});
