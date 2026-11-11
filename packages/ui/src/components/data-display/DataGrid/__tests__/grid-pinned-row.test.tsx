/**
 * The DataGrid's pinned row (FUT-4745): one row, named by id, shown first and
 * tinted with the theme's success colour, whatever the sort and the page.
 */
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataGrid } from '../DataGrid';
import { pinnedRowTint } from '../DataGrid.pinned';
import { pinRowFirst, processRows } from '../DataGrid.rows';
import type { DataGridProps, GridColumn, GridSort } from '../DataGrid.types';
import { PT_BR_DATA_GRID_COPY } from '../../../../pt-BR';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Bruno' },
  { id: 'b', name: 'Ana' },
  { id: 'c', name: 'Carla' },
  { id: 'd', name: 'Davi' },
];

const COLUMNS: GridColumn<Row>[] = [{ id: 'name', header: 'Nome', accessor: 'name' }];

const COLUMN_MAP = new Map(COLUMNS.map((column) => [column.id, column]));

function renderGrid(props: Partial<DataGridProps<Row>> = {}, mode: 'light' | 'dark' = 'light') {
  return render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <DataGrid<Row>
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        virtualizeRows={false}
        emptyText="vazio"
        copy={PT_BR_DATA_GRID_COPY}
        data-testid="grid"
        {...props}
      />
    </ThemeProvider>,
  );
}

const bodyNames = (): string[] =>
  Array.from(screen.getByTestId('grid').querySelectorAll('[data-slot="row"]')).map(
    (row) => row.querySelector('[data-col-id="name"]')?.textContent ?? '',
  );

describe('pinRowFirst', () => {
  it('moves the matching row to the front and keeps the others in order', () => {
    expect(pinRowFirst([1, 2, 3, 4], (n) => n === 3)).toEqual([3, 1, 2, 4]);
  });

  it('returns the same array when nothing matches or the row already leads', () => {
    const rows = [1, 2, 3];
    expect(pinRowFirst(rows, (n) => n === 9)).toBe(rows);
    expect(pinRowFirst(rows, (n) => n === 1)).toBe(rows);
  });
});

describe('processRows with a pinned row', () => {
  const base = {
    rows: ROWS,
    columnMap: COLUMN_MAP,
    filters: [],
    needsFiltering: false,
    needsPagination: false,
    pageIndex: 0,
    pageSize: 2,
  };
  const isPinned = (row: Row): boolean => row.id === 'c';

  it.each<[string, GridSort[]]>([
    ['ascending', [{ id: 'name', dir: 'asc' }]],
    ['descending', [{ id: 'name', dir: 'desc' }]],
  ])('leads under a %s sort, shown once', (_label, sortBy) => {
    const result = processRows({ ...base, sortBy, needsSorting: true, isPinned });
    expect(result[0]?.name).toBe('Carla');
    expect(result.filter(isPinned)).toHaveLength(1);
    expect(result).toHaveLength(ROWS.length);
  });

  it('leads page one, before the page slice, even when it sorts onto a later page', () => {
    const result = processRows({
      ...base,
      sortBy: [{ id: 'name', dir: 'asc' }],
      needsSorting: true,
      needsPagination: true,
      isPinned: (row) => row.id === 'd',
    });
    expect(result.map((row) => row.name)).toEqual(['Davi', 'Ana']);
  });

  it('is a no-op (same array) without a pinned row', () => {
    const result = processRows({ ...base, sortBy: [], needsSorting: false });
    expect(result).toBe(ROWS);
  });
});

describe('DataGrid pinnedRowId', () => {
  it('without the prop renders the rows exactly as before', () => {
    renderGrid({ sorting: { mode: 'client', sortBy: [{ id: 'name', dir: 'asc' }] } });
    expect(bodyNames()).toEqual(['Ana', 'Bruno', 'Carla', 'Davi']);
    expect(screen.getByTestId('grid').querySelector('[data-pinned]')).toBeNull();
  });

  it.each<['asc' | 'desc', string[]]>([
    ['asc', ['Carla', 'Ana', 'Bruno', 'Davi']],
    ['desc', ['Carla', 'Davi', 'Bruno', 'Ana']],
  ])('shows the pinned row first under a %s sort, once', (dir, expected) => {
    renderGrid({ pinnedRowId: 'c', sorting: { mode: 'client', sortBy: [{ id: 'name', dir }] } });
    expect(bodyNames()).toEqual(expected);
  });

  it('pins nothing, without throwing, for an id that matches no row', () => {
    renderGrid({ pinnedRowId: 'zzz', pinnedRowLabel: 'Saved now' });
    expect(bodyNames()).toEqual(['Bruno', 'Ana', 'Carla', 'Davi']);
    expect(screen.getByTestId('grid').querySelector('[data-pinned]')).toBeNull();
    expect(screen.queryByText('Saved now')).toBeNull();
  });

  it.each(['light', 'dark'] as const)(
    'tints the pinned row with the %s theme success colour, no literal',
    (mode) => {
      renderGrid({ pinnedRowId: 'c' }, mode);
      const pinned = screen.getByTestId('grid').querySelector('[data-pinned="true"]');
      expect(pinned).not.toBeNull();
      const expected = pinnedRowTint(createTheme({ palette: { mode } }));
      // jsdom normalises the colour; compare through a throwaway element.
      const probe = document.createElement('div');
      probe.style.backgroundColor = expected;
      expect(getComputedStyle(pinned as Element).backgroundColor).toBe(probe.style.backgroundColor);
    },
  );

  it('exposes the host label as hidden text inside the pinned row only', () => {
    renderGrid({ pinnedRowId: 'c', pinnedRowLabel: 'Saved now' });
    const pinned = screen.getByTestId('grid').querySelector('[data-pinned="true"]') as HTMLElement;
    expect(within(pinned).getByText('Saved now')).toHaveAttribute('data-slot', 'pinned-label');
    expect(screen.getAllByText('Saved now')).toHaveLength(1);
  });
});
