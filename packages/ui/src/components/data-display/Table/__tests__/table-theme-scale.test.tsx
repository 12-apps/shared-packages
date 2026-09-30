/**
 * THE VIRTUAL TABLE DRAWS AND POSITIONS ITS ROWS AT ONE PITCH (FUT-2598).
 *
 * `rowHeight` (default 52) and a numeric `containerHeight` are design px,
 * scaled with the theme's type scale. A virtualised row is drawn at `rowHeight`
 * and placed below a spacer row `startIndex × rowHeight` tall (FUT-2668), and
 * the window is picked by dividing `scrollTop` by the same pitch — if any of
 * the three kept the raw number while another followed the theme, rows would
 * overlap or leave gaps as the table scrolls.
 *
 * jsdom does not lay out, so these compare the numbers the table COMPUTES: the
 * height it writes on a row and on the spacer above the window, and the rows it
 * mounts for a scroll offset. The theme is a NON-default one (`fontSize: 12`, where `pxToRem(n)`
 * is `n × 12/14 / 16` rem) — at MUI's default nothing here could fail.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { Table } from '../Table';
import type { ColumnConfig } from '../Table.types';

const theme = createTheme({ typography: { fontSize: 12 } });
/** What one `rem` renders at here — the ratio `remPx` itself uses. */
const ROOT_PX = remPx(theme, 16) / Number.parseFloat(theme.typography.pxToRem(16));

/** A CSS length the table wrote (`2.78rem`, `52px`) in px. */
function cssPx(value: string): number {
  const n = Number.parseFloat(value);
  return value.endsWith('rem') ? n * ROOT_PX : n;
}

/** How far down the window's first row is placed: the spacer row above it, in px. */
function placedPx(first: HTMLElement): number {
  const spacer = first.previousElementSibling as HTMLElement;
  expect(spacer).toHaveAttribute('aria-hidden', 'true');
  return cssPx(spacer.style.height);
}

const columns: ColumnConfig[] = [{ key: 'name', label: 'Nome', width: 240, minWidth: 120 }];
const data = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `row-${i}` }));

function renderTable() {
  return render(
    <ThemeProvider theme={theme}>
      <Table
        emptyText="Nenhum dado"
        columns={columns}
        data={data}
        virtualScrolling
        containerHeight={400}
        overscan={0}
      />
    </ThemeProvider>,
  );
}

/** The mounted data rows, in DOM order. */
const dataRows = (): HTMLElement[] =>
  screen.getAllByRole('row').filter((row) => /^row-\d+$/.test(row.textContent ?? ''));

describe('Table (virtual scrolling) under a non-default type scale', () => {
  it('draws a row at the pitch it places rows by — the scaled design px', () => {
    renderTable();
    const scroller = dataRows()[0]!.closest('table')!.parentElement!;
    act(() => {
      fireEvent.scroll(scroller, { target: { scrollTop: 5 * remPx(theme, 52) + 1 } });
    });
    const rows = dataRows();
    const pitch = cssPx(rows[0]!.style.height);
    expect(pitch).toBeCloseTo(remPx(theme, 52), 6);
    // overscan is 0, so the first mounted row is `startIndex`.
    expect(rows[0]).toHaveTextContent('row-5');
    expect(placedPx(rows[0]!) / 5).toBeCloseTo(pitch, 6);
  });

  it('picks the window by dividing scrollTop by that same pitch', () => {
    renderTable();
    // The one scroll container wraps the whole table (FUT-2658).
    const scroller = dataRows()[0]!.closest('table')!.parentElement!;
    expect(cssPx(scroller.style.height)).toBeCloseTo(remPx(theme, 400), 6);

    act(() => {
      fireEvent.scroll(scroller, { target: { scrollTop: 100 * remPx(theme, 52) + 1 } });
    });
    const first = dataRows()[0]!;
    expect(first).toHaveTextContent('row-100');
    expect(placedPx(first) / 100).toBeCloseTo(remPx(theme, 52), 6);
  });

  it('sizes a column header from its design width', () => {
    renderTable();
    const header = screen.getByRole('columnheader');
    expect(cssPx(header.style.width)).toBeCloseTo(remPx(theme, 240), 6);
    expect(cssPx(header.style.minWidth)).toBeCloseTo(remPx(theme, 120), 6);
  });
});
