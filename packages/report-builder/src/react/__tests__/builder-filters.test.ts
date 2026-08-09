import { describe, expect, it } from 'vitest';

import {
  defaultValueFor,
  editFilterRow,
  filterFromWire,
  filterToWire,
  joinValueList,
  operatorOptionsFor,
  pickedLabels,
  splitValueList,
  toStringList,
  valueOptionsFor,
  valueShapeFor,
} from '../builder-filters';
import type { BuilderDraft } from '../builder-model';
import type { ReportField } from '../custom-reports-api';

/**
 * The filter row's half of FUT-391. The server decides what is legal; this
 * layer decides what the BUILDER can currently express, and keeps a row
 * internally consistent when its field changes.
 *
 * Plan entry 11 widened "what the builder can express" from the four
 * single-value operators to the spec's full set. The cases below are the two
 * halves of that: the OFFER (which operators a field shows) and the
 * SERIALIZATION (that each offered operator maps onto the arity
 * `reportFilterSchema` demands, so an offer can never become a 400).
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

/** An open string field: `in` is legal on it, but there is nothing to pick. */
const NOTE: ReportField = {
  field: 'note',
  label: 'Observação',
  type: 'string',
  role: 'dimension',
  ops: ['eq', 'neq', 'in'],
};

const FIELDS = new Map<string, ReportField>([
  ['status', STATUS],
  ['total', TOTAL],
  ['note', NOTE],
]);

const draftWith = (filters: BuilderDraft['filters']): BuilderDraft =>
  ({ filters }) as BuilderDraft;

describe('operatorOptionsFor', () => {
  it('offers the whole set a field declares, `in` and `between` included', () => {
    // This used to stop at the operators a single `value` could serialize.
    // `FilterDraft` now carries `values[]` and `from`/`to`, so the offer is the
    // server's answer unchanged.
    expect(operatorOptionsFor(STATUS)).toEqual(['eq', 'neq', 'in']);
    expect(operatorOptionsFor(TOTAL)).toEqual(['eq', 'neq', 'gte', 'lte', 'between']);
  });

  it('never returns an empty list', () => {
    // `contains` is the operator plan entry 11 found genuinely absent — no
    // schema arity, no compiler support — so the draft still cannot express it.
    const containsOnly: ReportField = { ...STATUS, ops: ['contains'] };
    expect(operatorOptionsFor(containsOnly)).toEqual(['eq']);
  });

  it('keeps the no-ops fallback narrow rather than widening it too', () => {
    // A cached listing predating `ops` says nothing about the field's TYPE, and
    // `compileReport` rejects a range operator on a string. Offering
    // `in`/`between` blind here would put back the very 400 the old
    // single-value narrowing existed to avoid.
    const legacy: ReportField = { field: 'x', label: 'X', type: 'string', role: 'dimension' };
    expect(operatorOptionsFor(legacy)).toEqual(['eq', 'neq', 'gte', 'lte']);
    expect(operatorOptionsFor(undefined)).toEqual(['eq', 'neq', 'gte', 'lte']);
  });
});

describe('valueShapeFor', () => {
  it('maps each operator onto the control shape its arity needs', () => {
    expect(valueShapeFor('eq')).toBe('single');
    expect(valueShapeFor('neq')).toBe('single');
    expect(valueShapeFor('gte')).toBe('single');
    expect(valueShapeFor('lte')).toBe('single');
    expect(valueShapeFor('in')).toBe('list');
    expect(valueShapeFor('between')).toBe('range');
  });

  it('treats an unknown operator as single-valued', () => {
    // The row still renders something usable rather than nothing at all.
    expect(valueShapeFor('contains')).toBe('single');
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

  it('re-picks a legal operator when the field no longer offers the old one', () => {
    // `between` is legal on money and absent from a closed set's ops, so the
    // row cannot survive the switch holding it.
    const draft = draftWith([
      { field: 'total', operator: 'between', value: '', from: '10', to: '90' },
    ]);
    const next = editFilterRow(draft, 0, { field: 'status' }, FIELDS);
    expect(operatorOptionsFor(STATUS)).toContain(next[0]?.operator);
    // And the previous shape leaves with it — no `from`/`to` riding along into
    // a spec whose operator takes a single value.
    expect(next).toEqual([{ field: 'status', operator: 'eq', value: 'PAID' }]);
  });

  it('leaves the value alone when only the operator changes', () => {
    const draft = draftWith([{ field: 'status', operator: 'eq', value: 'FAILED' }]);
    expect(editFilterRow(draft, 0, { operator: 'neq' }, FIELDS)).toEqual([
      { field: 'status', operator: 'neq', value: 'FAILED' },
    ]);
  });

  it('carries the picked value into `in`, and the first one back out', () => {
    // Blanking instead would clear the control the author just filled — and
    // with the preview re-running on every keystroke, flash an unfiltered block.
    const draft = draftWith([{ field: 'status', operator: 'eq', value: 'FAILED' }]);
    const asIn = editFilterRow(draft, 0, { operator: 'in' }, FIELDS);
    expect(asIn).toEqual([
      { field: 'status', operator: 'in', value: '', values: ['FAILED'] },
    ]);
    expect(editFilterRow(draftWith(asIn), 0, { operator: 'eq' }, FIELDS)).toEqual([
      { field: 'status', operator: 'eq', value: 'FAILED' },
    ]);
  });

  it('seeds `between` from the value it replaces and leaves the upper bound open', () => {
    const draft = draftWith([{ field: 'total', operator: 'gte', value: '1500' }]);
    expect(editFilterRow(draft, 0, { operator: 'between' }, FIELDS)).toEqual([
      { field: 'total', operator: 'between', value: '', from: '1500', to: '' },
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

describe('filterToWire', () => {
  it('writes `values[]` for `in` and `from`/`to` for `between`', () => {
    expect(
      filterToWire({ field: 'status', operator: 'in', value: '', values: ['PAID', 'FAILED'] }, STATUS),
    ).toEqual([{ field: 'status', operator: 'in', values: ['PAID', 'FAILED'] }]);
    expect(
      filterToWire({ field: 'total', operator: 'between', value: '', from: '10', to: '90' }, TOTAL),
    ).toEqual([{ field: 'total', operator: 'between', from: 10, to: 90 }]);
  });

  it('types the values of a number field, in every shape', () => {
    // `total gte "1500"` compiles and compares a money column against a string.
    expect(
      filterToWire({ field: 'total', operator: 'in', value: '', values: ['10', '20'] }, TOTAL),
    ).toEqual([{ field: 'total', operator: 'in', values: [10, 20] }]);
  });

  it('emits NOTHING for a row that is still being filled in', () => {
    // A half-filled `between` is exactly the spec the schema rejects; dropping
    // it keeps the live preview runnable mid-edit instead of bouncing on a 400.
    expect(
      filterToWire({ field: 'total', operator: 'between', value: '', from: '10', to: '' }, TOTAL),
    ).toEqual([]);
    expect(filterToWire({ field: 'status', operator: 'in', value: '', values: [] }, STATUS)).toEqual(
      [],
    );
    expect(filterToWire({ field: 'status', operator: 'eq', value: '  ' }, STATUS)).toEqual([]);
    expect(filterToWire({ field: '', operator: 'eq', value: 'PAID' }, undefined)).toEqual([]);
  });

  it('drops the blank entries of a half-typed comma list', () => {
    expect(
      filterToWire({ field: 'note', operator: 'in', value: '', values: ['a', ' ', 'b'] }, NOTE),
    ).toEqual([{ field: 'note', operator: 'in', values: ['a', 'b'] }]);
  });
});

describe('filterFromWire', () => {
  it('reads `in` and `between` back into an editable row', () => {
    expect(filterFromWire({ field: 'status', operator: 'in', values: ['PAID'] })).toEqual([
      { field: 'status', operator: 'in', value: '', values: ['PAID'] },
    ]);
    expect(filterFromWire({ field: 'total', operator: 'between', from: 10, to: 90 })).toEqual([
      { field: 'total', operator: 'between', value: '', from: '10', to: '90' },
    ]);
  });

  it('drops a stored filter that carries nothing for its operator', () => {
    expect(filterFromWire({ field: 'status', operator: 'in' })).toEqual([]);
    expect(filterFromWire({ field: 'total', operator: 'between', from: 10 })).toEqual([]);
    expect(filterFromWire({ field: 'status', operator: 'eq' })).toEqual([]);
  });
});

describe('the typed `in` list', () => {
  it('survives a controlled round trip mid-keystroke', () => {
    // `split`/`join` are exact inverses on purpose: trimming here would eat the
    // comma the author just pressed and jump the caret to the end of the field.
    for (const raw of ['PAID,', 'PAID, FAILED', 'a,,b', '']) {
      expect(joinValueList(splitValueList(raw))).toBe(raw);
    }
  });
});

describe('pickedLabels / toStringList', () => {
  it('shows the LABELS of a multi-pick, never the stored codes', () => {
    const options = valueOptionsFor(STATUS) ?? [];
    expect(pickedLabels(['PAID', 'FAILED'], options)).toBe('Pago, Falhou');
  });

  it('falls back to the code for a value the catalog no longer lists', () => {
    expect(pickedLabels(['GONE'], valueOptionsFor(STATUS) ?? [])).toBe('GONE');
  });

  it('narrows whatever MUI hands back', () => {
    expect(toStringList(['PAID'])).toEqual(['PAID']);
    expect(toStringList('PAID')).toEqual(['PAID']);
    expect(toStringList('')).toEqual([]);
    expect(toStringList(undefined)).toEqual([]);
    expect(toStringList(null)).toEqual([]);
  });
});
