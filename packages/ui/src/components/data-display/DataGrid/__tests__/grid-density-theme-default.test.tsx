/**
 * `DataGrid`'S DEFAULT DENSITY COMES FROM THE THEME (FUT-2769).
 *
 * `GridDensity` ('compact' | 'comfortable' | 'spacious') is not the theme's
 * three names, so the default goes through an alias table
 * (`mapThemeToGridDensity`, `DataGrid.model.ts`):
 *
 * | theme.density.level (or unset ⇒ 'normal') | DataGrid.density default |
 * | -- | -- |
 * | compact     | compact    |
 * | normal      | comfortable (today's literal — unchanged) |
 * | comfortable | spacious   |
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

describe("DataGrid's density defaults from the theme", () => {
  it("stays 'comfortable' (today's literal) with no theme density at all", () => {
    renderGrid(themeAt(undefined));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("stays 'comfortable' when the theme's own density level is 'normal' — the no-op case", () => {
    renderGrid(themeAt('normal'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });

  it("maps theme density 'compact' to the grid's own 'compact'", () => {
    renderGrid(themeAt('compact'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'compact');
  });

  it("maps theme density 'comfortable' to the grid's own 'spacious'", () => {
    renderGrid(themeAt('comfortable'));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'spacious');
  });

  it('lets an explicit density prop win over the theme', () => {
    renderGrid(themeAt('compact'), 'spacious');
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'spacious');
  });

  it("stays 'comfortable' for a raw numeric theme density — it names no level", () => {
    // resolveDensityFactor(1.5) => { factor: 1.5 }, no `.level` at all (a
    // repository setting a raw numeric density, not a named one); the alias
    // table is keyed off `.level`, so this is the 'normal' row: 'comfortable'.
    renderGrid(createTheme({ density: resolveDensityFactor(1.5) }));
    expect(screen.getByRole('grid')).toHaveAttribute('data-density', 'comfortable');
  });
});
