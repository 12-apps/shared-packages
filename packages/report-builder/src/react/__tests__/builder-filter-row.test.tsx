// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { FiltersSection } from '../builder-sections';
import type { BuilderDraft } from '../builder-model';
import type { ReportField } from '../custom-reports-api';

/**
 * Plan entry 11's acceptance at the SURFACE: `in` and `between` are expressible
 * without hand-editing a spec, and the first half of the entry — "filtering by
 * status never requires typing" — survives the widening.
 *
 * `builder-filters.test.ts` proves the row's rules and `builder-model.test.ts`
 * proves the spec they produce parses. What is left, and only checkable here,
 * is that each shape reaches a CONTROL: that `in` on a closed set is a picker
 * rather than a text box (typing the code back in would undo FUT-391), that
 * `between` gets two named bounds, and that every one of them announces its
 * role and index the way the panel's other controls do.
 *
 * jsdom has no layout engine, so nothing here proves the three-line row fits
 * 344px. It does prove the input to that: how many controls each line holds.
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

const FIELDS = [STATUS, TOTAL];

function draftWith(filter: BuilderDraft['filters'][number]): BuilderDraft {
  return {
    name: '',
    description: '',
    entity: 'orders',
    dimensions: [],
    measures: [{ field: 'total', aggregation: 'sum' }],
    filters: [filter],
    sort: [],
    chartType: 'table',
    stacked: false,
  };
}

/** Render one filter row and hand back the spy the section patches through. */
function renderFilter(filter: BuilderDraft['filters'][number]): ReturnType<typeof vi.fn> {
  const update = vi.fn();
  render(<FiltersSection draft={draftWith(filter)} fields={FIELDS} update={update} />);
  return update;
}

/** The accessible name a screen reader would resolve, without jest-dom. */
function accessibleName(element: HTMLElement): string {
  return element.getAttribute('aria-label')?.trim() ?? '';
}

function controlNames(): string[] {
  return [...screen.getAllByRole('combobox'), ...screen.queryAllByRole('textbox')].map(
    accessibleName,
  );
}

afterEach(cleanup);

describe('a single-value filter row is unchanged', () => {
  it('keeps the value beside the operator, under its existing test id', () => {
    renderFilter({ field: 'status', operator: 'eq', value: 'PAID' });

    expect(controlNames()).toEqual([
      'Filtro 1 — campo',
      'Filtro 1 — condição',
      'Filtro 1 — valor',
    ]);
    expect(screen.getByTestId('builder-filter-value-0')).toBeTruthy();
  });
});

describe('`in` — the set is PICKED, never typed', () => {
  const row = { field: 'status', operator: 'in', value: '', values: ['PAID'] };

  it('renders a picker rather than a text box for a closed-set field', () => {
    renderFilter(row);

    // The whole point of the entry: a typed `PAID` compiles, matches nothing,
    // and reads as missing data rather than as the typo it is.
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    const value = screen.getByTestId('builder-filter-value-0');
    expect(within(value).getByRole('combobox')).toBeTruthy();
  });

  it('shows the picked LABELS, not the codes the spec stores', () => {
    renderFilter(row);

    const value = screen.getByTestId('builder-filter-value-0');
    expect(value.textContent).toContain('Pago');
    expect(value.textContent).not.toContain('PAID');
  });

  it('adds a second value to the set when one is picked', () => {
    const update = renderFilter(row);

    fireEvent.mouseDown(within(screen.getByTestId('builder-filter-value-0')).getByRole('combobox'));
    fireEvent.click(screen.getByTestId('builder-filter-value-0-option-FAILED'));

    expect(update).toHaveBeenCalledWith({
      filters: [{ field: 'status', operator: 'in', value: '', values: ['PAID', 'FAILED'] }],
    });
  });

  it('names the set control by its role and index', () => {
    renderFilter(row);

    expect(controlNames()).toEqual([
      'Filtro 1 — campo',
      'Filtro 1 — condição',
      'Filtro 1 — valores',
    ]);
  });
});

describe('`between` — two bounds, on a line of their own', () => {
  const row = { field: 'total', operator: 'between', value: '', from: '10', to: '' };

  it('renders a named control per bound', () => {
    renderFilter(row);

    expect(controlNames()).toEqual([
      'Filtro 1 — campo',
      'Filtro 1 — condição',
      'Filtro 1 — de',
      'Filtro 1 — até',
    ]);
  });

  it('gives each bound its own test id and leaves the single-value one unused', () => {
    renderFilter(row);

    expect(screen.getByTestId('builder-filter-value-0-from')).toBeTruthy();
    expect(screen.getByTestId('builder-filter-value-0-to')).toBeTruthy();
    // There is no one "value" to drive for a range; a spec asserting the old id
    // here would be asserting a control that cannot exist.
    expect(screen.queryByTestId('builder-filter-value-0')).toBe(null);
  });

  it('patches only the bound that was edited', () => {
    const update = renderFilter(row);

    fireEvent.change(screen.getByLabelText('Filtro 1 — até'), { target: { value: '90' } });

    expect(update).toHaveBeenCalledWith({
      filters: [{ field: 'total', operator: 'between', value: '', from: '10', to: '90' }],
    });
  });

  it('leaves the second line to the operator and the remove control alone', () => {
    renderFilter(row);

    // The layout claim this file can actually check: three selects plus a
    // button never share one line (FUT-755). The field owns line one, the
    // operator and `⨯` own line two, and the bounds drop to a third — so the
    // widest line holds ONE select, which is what the 344px arithmetic allows.
    const operator = screen.getByTestId('builder-filter-operator-0');
    const secondLine = operator.parentElement?.parentElement;
    expect(within(secondLine as HTMLElement).getAllByRole('combobox')).toHaveLength(1);
    expect(within(secondLine as HTMLElement).queryAllByRole('textbox')).toEqual([]);
  });
});

describe('no control label is elided in any shape', () => {
  it.each([
    ['single', { field: 'status', operator: 'eq', value: 'PAID' }],
    ['list', { field: 'status', operator: 'in', value: '', values: ['PAID', 'FAILED'] }],
    ['range', { field: 'total', operator: 'between', value: '', from: '10', to: '90' }],
  ])('renders the full accessible name of every %s control', (_shape, filter) => {
    renderFilter(filter);

    // The popover this panel replaced rendered `St…` and `igu…`; a horizontal
    // ellipsis in a name is that failure back, in a shape the panel's own
    // suite does not exercise.
    expect(controlNames().filter((name) => name === '' || name.includes('…'))).toEqual([]);
  });
});

/**
 * FUT-755 — the row's controls are the same field style as the rest of the
 * column, without becoming the truncation this panel was built to end.
 *
 * `visual-pass.md` §Components: one field style. These four were the notch-less
 * half of a column whose other half floated its labels. They float theirs now —
 * but the operator lives in a fixed 104px box, so a legend reading
 * `Filtro 1 — con…` would trade one failure for the exact one the panel
 * replaced the popover to fix.
 *
 * So the two names differ on purpose, and both halves are pinned here: what a
 * sighted reader sees is short, and what a screen reader announces still says
 * which row it is in. jsdom cannot prove the short one fits its box — that is a
 * browser check — only that it is short enough to be worth checking.
 */
describe('every filter control is a labelled field', () => {
  it('shows a short visible label while announcing the indexed one', () => {
    renderFilter({ field: 'status', operator: 'eq', value: 'PAID' });

    const labels = Array.from(document.querySelectorAll('label')).map(
      (label) => label.textContent ?? '',
    );
    expect(labels).toEqual(['Campo', 'Condição', 'Valor']);

    // Unchanged: the accessible name is what entry 12's suite asserts, and a
    // visible label must not quietly take it over.
    expect(controlNames()).toEqual([
      'Filtro 1 — campo',
      'Filtro 1 — condição',
      'Filtro 1 — valor',
    ]);
  });

  it('labels the two bounds of a `between` row separately', () => {
    renderFilter({ field: 'total', operator: 'between', value: '', from: '10', to: '90' });

    const labels = Array.from(document.querySelectorAll('label')).map(
      (label) => label.textContent ?? '',
    );
    expect(labels).toEqual(['Campo', 'Condição', 'De', 'Até']);
  });
});
