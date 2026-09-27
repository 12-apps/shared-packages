/**
 * `Table`'S DEFAULT DENSITY COMES FROM THE THEME (FUT-2769).
 *
 * `TableDensity` is a verbatim match for the theme's `DensityLevel` — same
 * three names, same order — so no alias table is needed: the default becomes
 * `props.density ?? (useDensity().level ?? 'normal')`. At `theme.density`
 * unset, or its level `'normal'`, this reproduces today's literal default
 * (`'normal'`) exactly. An explicit `density` prop always wins.
 *
 * jsdom does not lay out, so density is proven the same way
 * `table-theme-scale.test.tsx` proves the type scale: by reading the row
 * height `Table.styles.ts` actually WRITES on a body cell (36 / 52 / 68
 * design px for compact / normal / comfortable), converted from the `rem`
 * string it is declared in back to px with the same ratio `remPx` uses.
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

const ROW_HEIGHT_PX = { compact: 36, normal: 52, comfortable: 68 } as const;

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

describe("Table's density defaults from the theme", () => {
  it("stays 'normal' (today's literal) with no theme density at all", () => {
    const theme = themeAt(undefined);
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.normal), 6);
  });

  it("stays 'normal' when the theme's own density level is 'normal' — the no-op case", () => {
    const theme = themeAt('normal');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.normal), 6);
  });

  it("defaults to 'compact' when the theme's density level is 'compact'", () => {
    const theme = themeAt('compact');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.compact), 6);
  });

  it("defaults to 'comfortable' when the theme's density level is 'comfortable'", () => {
    const theme = themeAt('comfortable');
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.comfortable), 6);
  });

  it('lets an explicit density prop win over a denser theme', () => {
    const theme = themeAt('compact');
    renderTable(theme, 'comfortable');
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.comfortable), 6);
  });

  it("falls back to 'normal' for a raw numeric theme density — it names no level", () => {
    // resolveDensityFactor(1.5) => { factor: 1.5 }, no `.level` at all (a
    // repository setting a raw numeric density, not a named one); the ticket's
    // alias tables are keyed off `.level`, so this is the 'normal' row.
    const theme = createTheme({ density: resolveDensityFactor(1.5) });
    renderTable(theme);
    expect(cellHeightPx(theme)).toBeCloseTo(remPx(theme, ROW_HEIGHT_PX.normal), 6);
  });
});
