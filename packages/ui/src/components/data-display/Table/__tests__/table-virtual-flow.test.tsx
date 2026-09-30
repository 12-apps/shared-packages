/**
 * A VIRTUAL ROW STAYS IN THE TABLE'S COLUMN GRID, AT EXACTLY ITS PITCH (FUT-2668).
 *
 * A virtual row used to be `position: absolute`, translated to its offset. A
 * browser blockifies an absolutely positioned `<tr>`, so its cells left the
 * table's columns and were as wide as their own content — and they were taller
 * than the row's box, spilling into the next row.
 *
 * Now the window's rows sit in the `<tbody>`'s flow between two spacer rows
 * standing in for the rows above and below it, the table lays its columns out
 * from the header (`table-layout: fixed`), and each virtual cell holds its
 * content in a wrapper the pitch less the cell's bottom rule tall.
 *
 * jsdom does not lay out (and does not blockify), so these read what the table
 * WRITES: computed `position` and `table-layout`, the spacers' heights and the
 * wrappers' heights. The column edges and the row pitch are measured in the
 * Storybook build. The theme is a non-default type scale (`fontSize: 12`), so a
 * hairline scaled with the type scale would not pass for one that is not.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { Table } from '../Table';
import type { ColumnConfig, TableProps } from '../Table.types';

const theme = createTheme({ typography: { fontSize: 12 } });
/** What one `rem` renders at here — the ratio `remPx` itself uses. */
const ROOT_PX = remPx(theme, 16) / Number.parseFloat(theme.typography.pxToRem(16));
const ROW_HEIGHT = 52;
const PITCH = remPx(theme, ROW_HEIGHT);
const TOTAL = 300;

/** One `12px` / `2.78rem` length in px. */
function lengthPx(value: string): number {
  const n = Number.parseFloat(value);
  return value.trim().endsWith('rem') ? n * ROOT_PX : n;
}

/** A CSS length the table wrote — a plain one, or `calc(a - b)` — in px. */
function cssPx(value: string): number {
  const calc = /^calc\((.+) - (.+)\)$/.exec(value);
  return calc ? lengthPx(calc[1]!) - lengthPx(calc[2]!) : lengthPx(value);
}

const columns: ColumnConfig[] = [
  { key: 'name', label: 'Nome', width: 240 },
  { key: 'total', label: 'Total', align: 'right' },
];
const rowsOf = (length: number) =>
  Array.from({ length }, (_, i) => ({ id: i, name: `row-${i}`, total: i }));
const data = rowsOf(TOTAL);

function renderTable(props: Partial<TableProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <Table
        emptyText="Nenhum dado"
        columns={columns}
        data={data}
        virtualScrolling
        rowHeight={ROW_HEIGHT}
        containerHeight={400}
        overscan={3}
        {...props}
      />
    </ThemeProvider>,
  );
}

/** The mounted data rows, in DOM order. */
const dataRows = (): HTMLTableRowElement[] =>
  (screen.getAllByRole('row') as HTMLTableRowElement[]).filter((row) =>
    /^row-\d+/.test(row.textContent ?? ''),
  );

/** The data index a mounted row draws, read off its first cell. */
const indexOf = (row: HTMLTableRowElement): number =>
  Number(/^row-(\d+)$/.exec(row.cells[0]?.textContent ?? '')?.[1]);

function scrollTo(scrollTop: number): void {
  const scroller = screen.getByRole('table').parentElement!;
  act(() => {
    fireEvent.scroll(scroller, { target: { scrollTop } });
  });
}

/** The `<tbody>`'s rows other than the data rows: the spacers. */
const spacerRows = (): HTMLTableRowElement[] => {
  const rows = dataRows();
  const body = rows[0]!.closest('tbody')!;
  return Array.from(body.rows).filter((row) => !rows.includes(row));
};

describe('Table (virtual scrolling) keeps its rows in the column grid', () => {
  it('leaves a virtual <tr> in the table flow, not absolutely positioned', () => {
    renderTable();
    scrollTo(100 * PITCH + 1);

    for (const row of dataRows()) {
      expect(getComputedStyle(row).position).not.toBe('absolute');
      expect(row.style.transform).toBe('');
    }
  });

  it('lays the table out with fixed columns, taken from the header', () => {
    renderTable();

    expect(getComputedStyle(screen.getByRole('table')).tableLayout).toBe('fixed');
  });

  it('stands a spacer row in for the rows above and below the window', () => {
    renderTable();
    scrollTo(100 * PITCH + 1);
    const rows = dataRows();
    const startIndex = indexOf(rows[0]!);
    const endIndex = indexOf(rows[rows.length - 1]!) + 1;
    expect(startIndex).toBeGreaterThan(0);

    const body = rows[0]!.closest('tbody')!;
    const [top, bottom] = [body.rows[0]!, body.rows[body.rows.length - 1]!];
    expect(spacerRows()).toEqual([top, bottom]);
    expect(cssPx(top.style.height)).toBeCloseTo(startIndex * PITCH, 6);
    expect(cssPx(bottom.style.height)).toBeCloseTo((TOTAL - endIndex) * PITCH, 6);
  });

  it('draws a spacer bare: hidden, spanning every column, with no MUI class', () => {
    renderTable({ selectable: true });
    scrollTo(100 * PITCH + 1);
    const spacers = spacerRows();
    expect(spacers).toHaveLength(2);

    for (const spacer of spacers) {
      expect(spacer).toHaveAttribute('aria-hidden', 'true');
      expect(spacer.className).toBe('');
      const cells = Array.from(spacer.children) as HTMLTableCellElement[];
      expect(cells).toHaveLength(1);
      expect(cells[0]!.colSpan).toBe(columns.length + 1);
      expect(cells[0]!.className).toBe('');
    }
  });

  it('renders no spacer for an empty stretch — none above the first row', () => {
    renderTable();

    expect(indexOf(dataRows()[0]!)).toBe(0);
    expect(spacerRows()).toHaveLength(1);
  });
});

describe('Table (virtual scrolling) draws each cell at exactly the pitch', () => {
  it.each([
    ['variant="minimal"', { variant: 'minimal' }],
    ['density="compact"', { density: 'compact' }],
    ['selectable', { selectable: true, density: 'comfortable' }],
  ] as const)('fills a %s cell with a wrapper the pitch less its bottom rule', (_, props) => {
    renderTable(props as Partial<TableProps>);
    const cells = Array.from(dataRows()[0]!.children) as HTMLElement[];
    expect(cells.length).toBeGreaterThan(0);

    for (const cell of cells) {
      const wrapper = cell.firstElementChild as HTMLElement;
      const rule = Number.parseFloat(getComputedStyle(cell).borderBottomWidth);
      expect(rule).toBeGreaterThan(0);
      expect(cssPx(wrapper.style.height)).toBeCloseTo(PITCH - rule, 6);
      expect(wrapper.style.overflow).toBe('hidden');
    }
  });

  it("keeps the column's alignment inside the wrapper", () => {
    renderTable();
    const [name, total] = Array.from(dataRows()[0]!.children) as HTMLElement[];

    expect((name!.firstElementChild as HTMLElement).style.justifyContent).toBe('flex-start');
    expect((total!.firstElementChild as HTMLElement).style.justifyContent).toBe('flex-end');
  });

  it('leaves the plain body alone: no wrapper, no row height, no spacer', () => {
    renderTable({ virtualScrolling: false, data: rowsOf(20) });
    const rows = dataRows();

    expect(rows).toHaveLength(20);
    expect(rows[0]!.style.height).toBe('');
    expect(rows[0]!.children[0]!.childElementCount).toBe(0);
    expect(getComputedStyle(screen.getByRole('table')).tableLayout).not.toBe('fixed');
  });
});
