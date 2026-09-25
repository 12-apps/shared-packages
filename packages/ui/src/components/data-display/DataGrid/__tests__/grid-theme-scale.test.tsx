/**
 * THE GRID'S ROW PITCH FOLLOWS THE THEME, IN THE CSS AND IN THE WINDOW MATHS
 * (FUT-2598).
 *
 * `rowHeight` (default 52) and `headerHeight` (default 56) are design px, scaled
 * with the theme's type scale. The row is DRAWN at that height and the
 * virtualisation window is POSITIONED with it — the spacer above the window is
 * `start` rows tall, and `start` is derived from `scrollTop / pitch`. If the two
 * disagree, the spacer and the rows no longer tile and the grid jumps as it
 * scrolls.
 *
 * jsdom does not lay out, so these compare the numbers the grid COMPUTES: the
 * height it writes on a row and on the spacer, and the window it picks for a
 * scroll offset. The theme is a NON-default one (`fontSize: 12`, where
 * `pxToRem(n)` is `n × 12/14 / 16` rem) — at MUI's default a design px is a CSS
 * px and nothing here could fail.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { DataGrid } from '../DataGrid';
import type { GridColumn } from '../DataGrid.types';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const theme = createTheme({ typography: { fontSize: 12 } });
/** What one `rem` renders at here — the ratio `remPx` itself uses. */
const ROOT_PX = remPx(theme, 16) / Number.parseFloat(theme.typography.pxToRem(16));

/** A computed CSS length (`2.78rem`, `44px`) in px. */
function cssPx(value: string): number {
  const n = Number.parseFloat(value);
  return value.endsWith('rem') ? n * ROOT_PX : n;
}

const heightOf = (node: Element): number => cssPx(globalThis.getComputedStyle(node).height);

/**
 * The spacer's height in px. It is declared as `calc(<rows> * <row height>)`,
 * which jsdom's computed style cannot evaluate, so this reads the declaration
 * off the stylesheet and does the one multiplication itself.
 */
function spacerPx(node: Element): number {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule) || !node.matches(rule.selectorText)) continue;
      const declared = rule.style.getPropertyValue('height');
      const calc = /^calc\((\d+) \* (.+)\)$/.exec(declared);
      if (calc) return Number(calc[1]) * cssPx(calc[2]!);
      if (declared) return cssPx(declared);
    }
  }
  return Number.NaN;
}

const columns: GridColumn<Row>[] = [{ id: 'name', header: 'Nome', width: 240 }];
const rows: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, name: `row-${i}` }));

function renderGrid() {
  return render(
    <ThemeProvider theme={theme}>
      <DataGrid<Row> emptyText="Nada" data-testid="grid" rows={rows} columns={columns} />
    </ThemeProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('DataGrid under a non-default type scale', () => {
  it('draws a row, and the header, at the scaled design height', () => {
    renderGrid();
    const [row] = screen.getAllByRole('row').filter((node) => node.getAttribute('data-slot') === 'row');
    expect(heightOf(row!)).toBeCloseTo(remPx(theme, 52), 6);
    const header = screen.getByRole('columnheader');
    expect(heightOf(header)).toBeCloseTo(remPx(theme, 56), 6);
    expect(cssPx(globalThis.getComputedStyle(header).width)).toBeCloseTo(remPx(theme, 240), 6);
  });

  it('positions the window with the pitch it draws: spacer = start rows of that height', () => {
    // The scroll handler defers to the next frame; run it now.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    renderGrid();
    const pitch = heightOf(
      screen.getAllByRole('row').find((node) => node.getAttribute('data-slot') === 'row')!,
    );

    const body = screen.getByTestId('grid').firstElementChild as HTMLElement;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 600 });
    // 100 rows down, at the pitch the THEME implies.
    act(() => {
      fireEvent.scroll(body, { target: { scrollTop: 100 * remPx(theme, 52) + 1 } });
    });

    // Overscan is 20 rows: the first mounted row is 20 above the first visible —
    // row 80 only if the window divides by that same pitch.
    const first = screen.getAllByRole('row').find((node) => node.getAttribute('data-slot') === 'row')!;
    expect(first).toHaveTextContent('row-80');

    const spacer = first.previousElementSibling!.firstElementChild!;
    expect(spacerPx(spacer) / 80).toBeCloseTo(pitch, 6);
  });
});
