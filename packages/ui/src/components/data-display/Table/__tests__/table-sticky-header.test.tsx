/**
 * A STICKY HEADER STICKS INSIDE THE TABLE'S OWN SCROLLER, NEVER THE PAGE (FUT-2677).
 *
 * `stickyHeader` sets `position: sticky` on the `<thead>`, which sticks within
 * its nearest ancestor scroll container. Two things stopped that ancestor from
 * ever scrolling: the `<table>` was itself a scroll container (`overflow:
 * hidden`, for its rounded corners), and `containerHeight` sized the
 * `TableContainer` only when `virtualScrolling` was also set.
 *
 * With `stickyHeader`, the `<table>` no longer clips: its rounded corners move
 * to the `TableContainer`, which already clips a scrolling table (`overflow:
 * auto` clips to the padding box). `containerHeight` now sizes the
 * `TableContainer` whenever it is set, with or without `virtualScrolling`.
 *
 * jsdom does not lay out, so these read what the table WRITES — computed
 * `overflow` on the `<table>` (an emotion class) and the `TableContainer`'s
 * own inline `borderRadius`/`height`/`overflow`. Actual sticking is checked in
 * a browser, in `Table.test.stories.tsx`.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Table } from '../Table';
import type { ColumnConfig } from '../Table.types';

const theme = createTheme();
const RADIUS = theme.spacing(1); // '8px' at the default theme

const columns: ColumnConfig[] = [{ key: 'name', label: 'Nome' }];
const data = [{ id: 1, name: 'row-0' }];

function renderTable(props: Record<string, unknown> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <Table emptyText="Nenhum dado" columns={columns} data={data} {...props} />
    </ThemeProvider>,
  );
}

/** The scroller: the `<table>`'s parent, MUI's `TableContainer`. */
const scrollerOf = (table: HTMLElement): HTMLElement => table.parentElement!;

describe('Table with stickyHeader: the <table> stops clipping', () => {
  it.each([
    ['populated', {}],
    ['loading', { loading: true }],
    ['empty', { data: [] }],
  ] as const)('lets a %s table\'s scroller take over the rounded clip', (_, extra) => {
    renderTable({ stickyHeader: true, ...extra });
    const table = screen.getByRole('table');

    const overflow = getComputedStyle(table).overflow;
    expect(['visible', '']).toContain(overflow);
    expect(scrollerOf(table).style.borderRadius).toBe(RADIUS);
  });

  it('keeps a non-sticky table exactly as it was: the <table> clips, at the theme radius', () => {
    renderTable();
    const table = screen.getByRole('table');

    expect(getComputedStyle(table).overflow).toBe('hidden');
    expect(getComputedStyle(table).borderRadius).toBe(RADIUS);
  });
});

describe('containerHeight sizes the scroller with or without virtualScrolling', () => {
  it('sizes the scroller from a numeric containerHeight alone', () => {
    renderTable({ containerHeight: 300 });
    const scroller = scrollerOf(screen.getByRole('table'));

    expect(scroller.style.height).toBe('18.75rem');
    expect(scroller.style.overflow).toBe('auto');
  });

  it('sizes the scroller from a string containerHeight alone', () => {
    renderTable({ containerHeight: '50vh' });
    const scroller = scrollerOf(screen.getByRole('table'));

    expect(scroller.style.height).toBe('50vh');
    expect(scroller.style.overflow).toBe('auto');
  });

  it('gives the scroller no height when containerHeight is unset', () => {
    renderTable();
    const scroller = scrollerOf(screen.getByRole('table'));

    expect(scroller.style.height).toBe('');
  });
});
