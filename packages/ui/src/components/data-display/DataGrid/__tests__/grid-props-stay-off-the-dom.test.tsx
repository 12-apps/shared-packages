/**
 * The grid's own configuration must not reach the DOM (FUT-1429).
 *
 * `DataGridProps` extends `React.HTMLAttributes`, so the rest-spread that
 * carries a host's real HTML attributes onto the root element carries the
 * grid's configuration with it. `GRID_ONLY_PROPS` is the denylist that stops
 * that, and its docblock has always said why: "React would warn (or worse,
 * serialize an array of rows into an attribute) if any of it reached the DOM."
 *
 * `emptyText` was missing from that list. It is a REQUIRED prop, so every grid
 * in every host emitted:
 *
 *   React does not recognize the `emptyText` prop on a DOM element. If you
 *   intentionally want it to appear in the DOM as a custom attribute, spell it
 *   as lowercase `emptytext` instead.
 *
 * It leaked on BOTH branches. `DataGridEmpty` does destructure `emptyText` out
 * before spreading its own rest — but the copy that reaches the DOM rides in
 * `placeholder.htmlProps`, which `Placeholder` spreads onto its Box either way.
 * Reading the destructure alone clears the wrong file.
 *
 * ## Two guards, and what each is worth
 *
 * The first names `emptyText`. The second names nothing: it renders a grid
 * carrying every name on `GRID_ONLY_PROPS` and asserts the root ends up with
 * only real DOM attributes, so dropping ANY name from the denylist fails it.
 * That is the one that catches the next omission, and it is only true because
 * the render below passes every entry — a guard that renders a bare grid
 * inspects nothing and passes whatever you break.
 *
 * `loading` and `error` are the two entries it cannot cover that way, since a
 * truthy value for either selects a placeholder branch instead of the grid;
 * the empty-state case covers the placeholder root separately.
 *
 * ## Why neither spies on `console.error`
 *
 * The obvious guard is to assert React logged no "does not recognize" warning.
 * It is INERT: React de-duplicates that warning by prop name for the lifetime of
 * the module registry, so the first render in the file consumes it and every
 * later case passes whether or not the leak is fixed. Written that way it passed
 * against the very defect it existed to catch.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataGrid, GRID_ONLY_PROPS } from '../DataGrid';
import type { DataGridProps, GridColumn } from '../DataGrid.types';

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Ana' },
  { id: 2, name: 'Bruno' },
];

const COLUMNS: GridColumn<Row>[] = [
  { id: 'id', header: 'ID', accessor: 'id', type: 'number' },
  { id: 'name', header: 'Nome', accessor: 'name', type: 'text' },
];

/** `class`, `style`, `id`, `role`, and any `aria-*` / `data-*` are legitimate. */
const ALLOWED = /^(class|style|id|role|title|tabindex|aria-[a-z-]+|data-[a-z-]+)$/;

const leakedAttributes = (root: HTMLElement): string[] =>
  root.getAttributeNames().filter((name) => !ALLOWED.test(name));

describe('Given a grid with rows, when it renders', () => {
  it('then emptyText is not written onto the root element', () => {
    const { getByTestId } = render(
      <DataGrid<Row>
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        emptyText="Nada por aqui"
        data-testid="grid"
      />,
    );

    // React lowercases an unknown prop on its way to the DOM, so the attribute
    // to look for is `emptytext`, not the camelCase name.
    const root = getByTestId('grid');
    expect(root.hasAttribute('emptytext')).toBe(false);
    expect(root.outerHTML).not.toContain('Nada por aqui');
  });
});

/**
 * Every grid-only prop except the two that select a different branch. Declared
 * as one object so the case below can assert it still COVERS the denylist —
 * add a name to `GRID_ONLY_PROPS` and forget it here and that assertion fails,
 * which is the hole a hand-written JSX list would leave open.
 */
const BRANCHING = ['loading', 'error'] as const;

const GRID_CONFIG = {
  emptyText: 'Nada por aqui',
  emptyState: <span>vazio</span>,
  sizeMode: 'fixed',
  density: 'compact',
  rowHeight: 36,
  headerHeight: 36,
  footerHeight: 36,
  selection: { mode: 'multi', selectedRowIds: [] },
  pagination: { mode: 'client', pageIndex: 0, pageSize: 10 },
  sorting: { mode: 'client', sortBy: [] },
  filtering: { mode: 'client', filters: [] },
  expansion: { render: () => <span>mais</span>, expandedRowIds: [] },
  editing: { mode: 'none' },
  virtualizeRows: false,
  virtualizeColumns: false,
  stickyHeader: true,
  stickyFooter: false,
  onRequestData: () => undefined,
  ariaLabel: 'Clientes',
  ariaDescription: 'Lista de clientes',
  // `satisfies` rather than `as const`: the shape is still checked against the
  // real prop types, but the nested arrays stay mutable, which `as const` would
  // freeze into `readonly []` and reject at the call site.
} satisfies Partial<DataGridProps<Row>>;

describe('Given a grid carrying every name on the denylist, when it renders', () => {
  it('then the config below still covers the denylist', () => {
    const covered = new Set([
      'rows',
      'columns',
      'getRowId',
      ...Object.keys(GRID_CONFIG),
      ...BRANCHING,
    ]);
    expect(GRID_ONLY_PROPS.filter((prop) => !covered.has(prop))).toEqual([]);
  });

  it('then the root carries no attribute that is not a real DOM attribute', () => {
    const { getByTestId } = render(
      <DataGrid<Row>
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        {...GRID_CONFIG}
        data-testid="grid"
      />,
    );

    expect(leakedAttributes(getByTestId('grid'))).toEqual([]);
  });
});

describe('Given a grid with no rows, when the empty state renders', () => {
  it('then emptyText is shown as text and not as an attribute', () => {
    const { getByTestId } = render(
      <DataGrid<Row>
        rows={[]}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        emptyText="Nada por aqui"
        data-testid="grid"
      />,
    );

    const root = getByTestId('grid');
    expect(root.hasAttribute('emptytext')).toBe(false);
    expect(leakedAttributes(root)).toEqual([]);
    expect(root.textContent).toContain('Nada por aqui');
  });
});
