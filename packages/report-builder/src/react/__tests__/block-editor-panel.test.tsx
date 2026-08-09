// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BlockEditorPanel } from '../block-editor-panel';
import type { ReportEntityFields, ReportField, ReportSpecWire } from '../custom-reports-api';

/**
 * Plan entries 9 (side panel) and 12 (labelled sections) are both marked
 * ALREADY DONE. A status line rots the moment someone edits the file; these
 * cases are the version of that status that cannot.
 *
 * Entry 12's acceptance — "no unlabelled select in the panel" — is asserted
 * exactly: every combobox the panel renders must resolve to a non-empty
 * accessible name.
 *
 * Entry 9's acceptance — "no truncated control labels at any viewport >=360px"
 * — is asserted as far as jsdom honestly can. There is no layout engine here,
 * so nothing in this file proves a label does not overflow its box. What it
 * does prove is that BOTH layout branches — the 344px right-hand panel and the
 * bottom sheet below 760px — render every label in full, so a regression to
 * the popover's `St…` / `igu…` fails as a string rather than as a screenshot
 * nobody takes. Pixel overflow is a browser check.
 */

const FIELDS: ReportField[] = [
  { field: 'createdAt', label: 'Data', type: 'date', role: 'dimension' },
  { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
  { field: 'status', label: 'Status', type: 'string', role: 'dimension' },
  { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
];

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: FIELDS,
};

/** A date axis, so the grain select renders alongside the axis select. */
const SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum' }],
  filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
  sort: [],
  presentation: { kind: 'chart', chartType: 'bar' },
};

const DESKTOP_PX = 1280;

/**
 * The width the stubbed `matchMedia` answers from. A container property rather
 * than a closed-over binding: the flakiness gate rejects reassigning the
 * latter from inside a stub, and a mutated container is the shape it wants.
 */
const viewport = { width: DESKTOP_PX };

const realMatchMedia = window.matchMedia;

/** Choose the branch this test renders. Read by the stub below. */
function setViewport(widthPx: number): void {
  viewport.width = widthPx;
}

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering from an explicit width makes the panel/sheet branch a choice the
 * test makes rather than a default it inherits — and installing it per test,
 * with a restore, keeps the mutation from leaking into any other suite.
 */
beforeEach(() => {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)/.exec(query);
    return {
      matches: max ? viewport.width <= Number(max[1]) : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
});

function renderPanel(): void {
  render(
    <BlockEditorPanel
      open
      onClose={() => undefined}
      entities={[ENTITY]}
      spec={SPEC}
      span={6}
      onChange={() => undefined}
      onSpanChange={() => undefined}
      testId="report-block-b1-editor"
    />,
  );
}

/**
 * The accessible name as a screen reader would resolve it, without pulling in
 * jest-dom — this package's suites use plain vitest matchers.
 */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();

  const ids = element.getAttribute('aria-labelledby');
  if (ids === null) return '';
  return ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  viewport.width = DESKTOP_PX;
});

describe('BlockEditorPanel — entry 12: no unlabelled select in the panel', () => {
  it.each([
    ['the desktop panel', 1280],
    ['the bottom sheet', 390],
  ])('names every select in %s', (_branch, widthPx) => {
    setViewport(widthPx);
    renderPanel();

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);

    const unnamed = selects.filter((select) => accessibleName(select) === '');
    expect(unnamed).toEqual([]);
  });

  it('labels the axis, the grain and the series split as three separate controls', () => {
    setViewport(1280);
    renderPanel();

    const names = screen.getAllByRole('combobox').map(accessibleName);
    // MUI names a select from its label AND its current value, so the axis
    // reads "Eixo X Data". Match on the label each control leads with.
    const labelled = (label: string): boolean =>
      names.some((name) => name.startsWith(label));

    // The three the plan calls out by name. `Por` renders only for a date
    // axis, which SPEC has.
    expect(labelled('Eixo X')).toBe(true);
    expect(labelled('Por')).toBe(true);
    expect(labelled('Uma série por')).toBe(true);
  });

  it('names the measure and filter selects by their ROLE, not by their value', () => {
    setViewport(1280);
    renderPanel();

    const names = screen.getAllByRole('combobox').map(accessibleName);

    // These five carry `aria-label` rather than a visible label. Naming them
    // by value is the failure this pins: a filter's field select announcing
    // as "Status" tells a screen-reader user what it currently holds and
    // nothing about what it IS. `Status` is also a legitimate field label, so
    // asserting the role names is the only way to tell the two apart.
    expect(names).toEqual(
      expect.arrayContaining([
        'Medida 1',
        'Agregação',
        'Filtro 1 — campo',
        'Filtro 1 — condição',
      ]),
    );
  });
});

describe('BlockEditorPanel — entry 9: labels survive the narrow branch', () => {
  it.each([
    ['the desktop panel', 1280],
    ['the bottom sheet', 390],
  ])('renders no elided control label in %s', (_branch, widthPx) => {
    setViewport(widthPx);
    renderPanel();

    // The popover this replaced rendered `St…` and `igu…`. A horizontal
    // ellipsis anywhere in a control's accessible name is that failure back.
    const elided = screen
      .getAllByRole('combobox')
      .map(accessibleName)
      .filter((name) => name.includes('…'));
    expect(elided).toEqual([]);
  });

  it('keeps the full section headings at 390px', () => {
    setViewport(390);
    renderPanel();

    // Full strings, not prefixes: `getByText` with an exact string fails on a
    // truncated render.
    expect(screen.getByText('Agrupar por')).toBeTruthy();
    expect(screen.getByText('Separar em séries')).toBeTruthy();
  });
});
