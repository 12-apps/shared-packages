/**
 * `Table`'S DENSITY DOES NOT DEFAULT FROM THE THEME (FUT-2886).
 *
 * FUT-2769 defaulted `density` from `useDensity()` — `props.density ??
 * (useDensity().level ?? 'normal')` — which combined with `Table.styles.ts`'s
 * OWN discrete per-density row-height table (36 / 52 / 68 design px) to scale
 * row height TWICE under a themed density: a compact theme picked the
 * discrete 36px row AND then had that 36 scaled again by the same theme's
 * `typography.fontSize` factor through `rem()` — `36 * 0.9 = 32.4px`, not a
 * clean `0.9×` of anything (found by the adversarial review of FUT-2768,
 * shipped by FUT-2769).
 *
 * The fix: `Table`'s own discrete density is always `'normal'` unless the
 * caller passes `density` explicitly — it no longer reads `useDensity()` at
 * all. A theme density still scales row height, but only ONCE, through the
 * `rem()` a normal-density row is drawn with: `52 * 0.9` under a compact
 * theme, `52 * 1.1` under a comfortable one.
 *
 * jsdom does not lay out, so density is proven the same way
 * `table-theme-scale.test.tsx` proves the type scale: by reading the row
 * height `Table.styles.ts` actually WRITES on a body cell, converted from the
 * `rem` string it is declared in back to px with the same ratio `remPx` uses.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { resolveDensityFactor, type DensityLevel } from '../../../../tokens/density';
import { Table } from '../Table';
import type { ColumnConfig } from '../Table.types';

const columns: ColumnConfig[] = [{ key: 'name', label: 'Nome' }];
const data = [{ id: 1, name: 'Ana' }];

/** `'normal'`'s own discrete row height (design px) — the only one this file expects. */
const NORMAL_ROW_HEIGHT_PX = 52;

function themeAt(level?: DensityLevel) {
  return createTheme(level ? { density: resolveDensityFactor(level) } : {});
}

/** The body cell's `height`, in px — the design px a density resolves to. */
function cellHeightPx(theme: ReturnType<typeof themeAt>): number {
  const cell = screen.getAllByRole('cell')[0]!;
  const declared = globalThis.getComputedStyle(cell).height;
  const n = Number.parseFloat(declared);
  const rootPx = remPx(theme, 16) / Number.parseFloat(theme.typography.pxToRem(16));
  return declared.endsWith('rem') ? n * rootPx : n;
}

function renderTable(theme: ReturnType<typeof themeAt>, density?: DensityLevel) {
  return render(
    <ThemeProvider theme={theme}>
      <Table emptyText="Nenhum dado" columns={columns} data={data} density={density} />
    </ThemeProvider>,
  );
}

/** Row height at 'normal', scaled by this theme's own `rem()` factor. */
const expectedNormalPx = (theme: ReturnType<typeof themeAt>) => remPx(theme, NORMAL_ROW_HEIGHT_PX);

describe("Table's density no longer defaults from the theme (FUT-2886)", () => {
  it('stays normal with no theme density at all', () => {
    const theme = themeAt(undefined);
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(expectedNormalPx(theme), 6);
  });

  it("stays normal when the theme's own density level is 'normal' — the no-op case", () => {
    const theme = themeAt('normal');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(expectedNormalPx(theme), 6);
  });

  it("stays normal under a 'compact' theme with no density prop — scaled ONCE by rem(), not re-picked from a discrete table", () => {
    const theme = themeAt('compact');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(expectedNormalPx(theme), 6);
  });

  it("stays normal under a 'comfortable' theme with no density prop — same single-scale rule", () => {
    const theme = themeAt('comfortable');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(expectedNormalPx(theme), 6);
  });

  it('stays normal for a raw numeric theme density — it names no level', () => {
    const theme = createTheme({ density: resolveDensityFactor(1.5) });
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(expectedNormalPx(theme), 6);
  });

  it('lets an explicit density prop win over any theme (regression guard)', () => {
    const theme = themeAt('compact');
    renderTable(theme, 'comfortable');
    // 68 is 'comfortable's own discrete row height, scaled by the compact
    // theme's rem() factor on top — the explicit prop still picks the
    // discrete row, exactly as before this ticket.
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, 68), 6);
  });
});
