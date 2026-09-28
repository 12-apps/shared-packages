/**
 * `DataGrid`'S DENSITY NO LONGER DEFAULTS FROM THE THEME (FUT-2886).
 *
 * FUT-2769 defaulted `density` from `useDensity()` through an alias table
 * (`mapThemeToGridDensity`) — `props.density ?? mapThemeToGridDensity(theme.density.level
 * ?? 'normal')` — which combined with `densityHeight`'s own discrete
 * per-density row-height table (0.8x compact / 1.2x spacious) to scale row
 * height TWICE under a themed density: the alias table picked a DIFFERENT
 * discrete `GridDensity`, and `rem()` then scaled THAT row height again by
 * the same theme's `typography.fontSize` factor.
 *
 * The fix (mirroring Table's own FUT-2886 fix): with no `density` prop, the
 * grid's own discrete density is always `'comfortable'` — the grid's normal
 * density, `mapThemeToGridDensity('normal')`'s own former result — never
 * re-picked from the theme. A theme density still scales row height, but
 * only ONCE, through the `rem()` a comfortable-density row is drawn with.
 *
 * `data-density` is the grid's own reported default (`DataGrid.tsx`'s
 * `resolveChrome`), fed by the SAME resolved value the row-height geometry
 * uses (`DataGrid.model.ts`'s `densityHeight`) — so this is not just a
 * cosmetic attribute, it is what the grid actually measured itself against.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PT_BR_DATA_GRID_COPY } from '../../../../pt-BR';
import { resolveDensityFactor, type DensityLevel } from '../../../../tokens/density';
import { DataGrid } from '../DataGrid';
import type { GridColumn, GridDensity } from '../DataGrid.types';

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const columns: GridColumn<Row>[] = [{ id: 'name', header: 'Nome', accessor: 'name' }];
const rows: Row[] = [{ id: '1', name: 'Ana' }];

function themeAt(level?: DensityLevel) {
  return createTheme(level ? { density: resolveDensityFactor(level) } : {});
}

function renderGrid(theme: ReturnType<typeof themeAt>, density?: GridDensity) {
  return render(
    <ThemeProvider theme={theme}>
      <DataGrid<Row> emptyText="Nada" rows={rows} columns={columns} ariaLabel="grid" density={density} copy={PT_BR_DATA_GRID_COPY} />
    </ThemeProvider>,
  );
}

describe("DataGrid's density no longer defaults from the theme (FUT-2886)", () => {
  it("stays 'comfortable' with no theme density at all", () => {
    renderGrid(themeAt(undefined));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("stays 'comfortable' when the theme's own density level is 'normal' — the no-op case", () => {
    renderGrid(themeAt('normal'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("stays 'comfortable' under a 'compact' theme with no density prop — no longer re-picked from the theme", () => {
    renderGrid(themeAt('compact'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("stays 'comfortable' under a 'comfortable' theme with no density prop — same single-scale rule", () => {
    renderGrid(themeAt('comfortable'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("stays 'comfortable' for a raw numeric theme density — it names no level", () => {
    renderGrid(createTheme({ density: resolveDensityFactor(1.5) }));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it('lets an explicit density prop win over any theme (regression guard)', () => {
    renderGrid(themeAt('compact'), 'spacious');
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'spacious');
  });
});
