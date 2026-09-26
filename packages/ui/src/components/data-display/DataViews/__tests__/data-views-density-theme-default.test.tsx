import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { resolveDensityFactor, type DensityLevel } from "../../../../tokens/density";
import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn } from "../data-views-types";

/**
 * `DataViews`' DEFAULT DENSITY COMES FROM THE THEME (FUT-2769).
 *
 * `DataViewsDensity` ('compact' | 'cozy' | 'comfortable') is not the theme's
 * three names, so the default goes through an alias table
 * (`mapThemeToDataViewsDensity`, `data-views-layout-context.tsx`):
 *
 * | theme.density.level (or unset ⇒ 'normal') | DataViews default |
 * | -- | -- |
 * | compact     | compact     |
 * | normal      | cozy (today's literal — unchanged) |
 * | comfortable | comfortable |
 *
 * The STORED per-viewer preference (`dataviews:density` in `localStorage`)
 * still wins over the theme default, unchanged from today — only the
 * app-level constant is new.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
}

const rows: Row[] = [{ id: "1", nome: "Ana" }];
const columns: DataViewColumn<Row>[] = [{ id: "nome", header: "Nome", accessor: "nome", searchable: true }];

const STORAGE_KEY = "dataviews:density";

function themeAt(level?: DensityLevel) {
  return createTheme(level ? { density: resolveDensityFactor(level) } : {});
}

function renderGrid(prefix: string, theme: ReturnType<typeof themeAt>) {
  return render(
    <ThemeProvider theme={theme}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId={prefix}
        testIdPrefix={prefix}
      />
    </ThemeProvider>,
  );
}

/** Open "Exibir" and go to the Exibição tab, where the density tiles live. */
async function openDisplayTab(prefix: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`${prefix}-display-trigger`));
  fireEvent.click(await screen.findByTestId(`${prefix}-display-tab-display`));
}

beforeEach(() => window.localStorage.clear());

describe("DataViews' density defaults from the theme", () => {
  it("stays 'cozy' (today's literal) with no theme density at all", async () => {
    renderGrid("produtos", themeAt(undefined));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("stays 'cozy' when the theme's own density level is 'normal' — the no-op case", async () => {
    renderGrid("produtos", themeAt("normal"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("maps theme density 'compact' to DataViews' own 'compact'", async () => {
    renderGrid("produtos", themeAt("compact"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-compact")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("maps theme density 'comfortable' to DataViews' own 'comfortable'", async () => {
    renderGrid("produtos", themeAt("comfortable"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-comfortable")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("lets a stored per-viewer preference win over the theme default", async () => {
    window.localStorage.setItem(STORAGE_KEY, "comfortable");
    renderGrid("produtos", themeAt("compact"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-comfortable")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("stays 'cozy' for a raw numeric theme density — it names no level", async () => {
    // resolveDensityFactor(1.5) => { factor: 1.5 }, no `.level` at all (a
    // repository setting a raw numeric density, not a named one); the alias
    // table is keyed off `.level`, so this is the 'normal' row: 'cozy'.
    renderGrid("produtos", createTheme({ density: resolveDensityFactor(1.5) }));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });
});
