/**
 * The DataGrid's pinned row (FUT-4745): one row, named by id, shown first and
 * marked with the theme's primary colour (a faint fill and a leading accent),
 * whatever the sort and the page.
 */
import {
  createTheme,
  decomposeColor,
  getContrastRatio,
  recomposeColor,
  ThemeProvider,
  type Theme,
} from '@mui/material/styles/index.js';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataGrid } from '../DataGrid';
import { pinnedRowAccent, pinnedRowHoverTint, pinnedRowTint } from '../DataGrid.pinned';
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

/** The same rows keyed "1".."4", to pin with a NUMBER. */
const STRING_ID_ROWS: Row[] = [
  { id: '1', name: 'Bruno' },
  { id: '2', name: 'Ana' },
  { id: '3', name: 'Carla' },
  { id: '4', name: 'Davi' },
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

/** A colour as jsdom serialises it, through a throwaway element. */
function normalised(colour: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = colour;
  return probe.style.backgroundColor;
}

/** `fg` at its own alpha laid over the opaque `bg`, as an opaque rgb(). */
function over(fg: string, bg: string): string {
  const top = decomposeColor(fg);
  const base = decomposeColor(bg).values;
  const a = top.values[3] ?? 1;
  const mixed = [0, 1, 2].map((i) => Math.round((top.values[i] ?? 0) * a + (base[i] ?? 0) * (1 - a)));
  return recomposeColor({ type: 'rgb', values: mixed as [number, number, number] });
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
    const sorted = processRows({ ...base, sortBy, needsSorting: true, isPinned });
    expect(sorted[0]?.name).toBe('Carla');
    expect(sorted.filter(isPinned)).toHaveLength(1);
    expect(sorted).toHaveLength(ROWS.length);
  });

  it('leads page one, before the page slice, even when it sorts onto a later page', () => {
    const firstPage = processRows({
      ...base,
      sortBy: [{ id: 'name', dir: 'asc' }],
      needsSorting: true,
      needsPagination: true,
      isPinned: (row) => row.id === 'd',
    });
    expect(firstPage.map((row) => row.name)).toEqual(['Davi', 'Ana']);
  });

  it('is a no-op (same array) without a pinned row', () => {
    const untouched = processRows({ ...base, sortBy: [], needsSorting: false });
    expect(untouched).toBe(ROWS);
  });
});

describe('DataGrid pinnedRowId', () => {
  it('without the prop renders the rows exactly as before', () => {
    renderGrid({ sorting: { mode: 'client', sortBy: [{ id: 'name', dir: 'asc' }] } });
    expect(bodyNames()).toEqual(['Ana', 'Bruno', 'Carla', 'Davi']);
    expect(screen.getByTestId('grid').querySelectorAll('[data-pinned]')).toHaveLength(0);
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
    expect(screen.getByTestId('grid').querySelectorAll('[data-pinned]')).toHaveLength(0);
    expect(screen.queryAllByText('Saved now')).toHaveLength(0);
  });

  it('pins a string id when handed the same id as a number', () => {
    renderGrid({ rows: STRING_ID_ROWS, pinnedRowId: 3 });
    expect(bodyNames()[0]).toBe('Carla');
    expect(screen.getByTestId('grid').querySelectorAll('[data-pinned="true"]')).toHaveLength(1);
  });

  it.each(['light', 'dark'] as const)(
    'fills the pinned row with the %s theme primary tint and draws the accent bar, no literal',
    (mode) => {
      renderGrid({ pinnedRowId: 'c' }, mode);
      const pinned = screen.getByTestId('grid').querySelector('[data-pinned="true"]') as HTMLElement;
      const theme = createTheme({ palette: { mode } });
      expect(getComputedStyle(pinned).backgroundColor).toBe(normalised(pinnedRowTint(theme)));
      const firstCell = pinned.querySelector('td') as HTMLElement;
      expect(getComputedStyle(firstCell).boxShadow).toBe(pinnedRowAccent(theme));
    },
  );

  it('lets the selection colour win on a selected pinned row', () => {
    renderGrid({
      pinnedRowId: 'c',
      selection: { mode: 'multi', selectedRowIds: ['c'], onChangeSelected: () => undefined },
    });
    const pinned = screen.getByTestId('grid').querySelector('[data-pinned="true"]') as HTMLElement;
    expect(pinned).toHaveAttribute('data-selected', 'true');
    expect(getComputedStyle(pinned).backgroundColor).toBe(
      normalised(createTheme().palette.action.selected),
    );
  });

  it('exposes the host label as hidden text inside the pinned row only', () => {
    renderGrid({ pinnedRowId: 'c', pinnedRowLabel: 'Saved now' });
    const pinned = screen.getByTestId('grid').querySelector('[data-pinned="true"]') as HTMLElement;
    expect(within(pinned).getByText('Saved now')).toHaveAttribute('data-slot', 'pinned-label');
    expect(screen.getAllByText('Saved now')).toHaveLength(1);
  });
});

/**
 * The mark must not cost the row's own text its contrast: a red `error.main`
 * chip label (outlined, so its text sits right on the row) keeps 4.5:1 on the
 * pinned row, on both MUI default themes and on the two brand themes the
 * Storybook previews with. At success/0.08 it fell to 4.49 (light) and 3.92
 * (dark) — UI review, FUT-4745 round 1.
 *
 * Measured on the surface the row really sits on: the grid is an elevation-1
 * Paper, which in dark mode lays a white overlay on `background.paper`.
 */
describe('pinned row contrast', () => {
  const themes: Array<[string, Theme]> = [
    ['default light', createTheme({ palette: { mode: 'light' } })],
    ['default dark', createTheme({ palette: { mode: 'dark' } })],
    ['indigo light', createTheme({ palette: { mode: 'light', primary: { main: '#6366F1' } } })],
    ['indigo dark', createTheme({ palette: { mode: 'dark', primary: { main: '#818CF8' } } })],
  ];

  /** Paper, page, and — in dark — Paper under its elevation-1 overlay (alpha 0.051). */
  function surfaces(theme: Theme): string[] {
    const { paper, default: page } = theme.palette.background;
    if (theme.palette.mode === 'light') return [paper, page];
    return [paper, page, over('rgba(255, 255, 255, 0.051)', paper)];
  }

  it.each(themes)('keeps error.main text at 4.5:1 or better on the resting %s pinned row', (_name, theme) => {
    for (const surface of surfaces(theme)) {
      expect(getContrastRatio(theme.palette.error.main, over(pinnedRowTint(theme), surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes.filter(([name]) => name.endsWith('light')))(
    'keeps it at 4.5:1 or better on the hovered %s pinned row',
    (_name, theme) => {
      for (const surface of surfaces(theme)) {
        const hovered = over(pinnedRowHoverTint(theme), surface);
        expect(getContrastRatio(theme.palette.error.main, hovered)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(themes.filter(([name]) => name.endsWith('dark')))(
    'adds no fill in %s, and hovers exactly like every other row',
    (_name, theme) => {
      expect(decomposeColor(pinnedRowTint(theme)).values[3]).toBe(0);
      expect(pinnedRowHoverTint(theme)).toBe(theme.palette.action.hover);
    },
  );
});
