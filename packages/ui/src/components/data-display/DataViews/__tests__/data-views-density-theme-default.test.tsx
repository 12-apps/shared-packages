import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { resolveDensityFactor, type DensityLevel } from "../../../../tokens/density";
import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn } from "../data-views-types";

/**
 * `DataViews`' DENSITY DOES NOT DEFAULT FROM THE THEME (FUT-2886).
 *
 * FUT-2769 aliased the theme's density level to `DataViewsDensity` through
 * `mapThemeToDataViewsDensity` ('compact' ⇒ 'compact', 'comfortable' ⇒
 * 'comfortable', anything else ⇒ 'cozy'). Combined with the density's own
 * `rem()`-scaled row height (`DENSITY_ROW_PADDING`), that scaled a DataViews
 * table's rows the same way `Table`'s did: twice under a themed density —
 * once by picking a DIFFERENT discrete density, and again through the
 * theme's own type-scale factor.
 *
 * The fix: `DataViewsLayoutProvider`'s own discrete density is always
 * `'cozy'` (today's literal, unchanged) unless something is STORED for this
 * viewer — `mapThemeToDataViewsDensity` and the `useDensity()` read it
 * sourced its default from are both gone. A theme density still scales row
 * height, but only ONCE, through `rem()`.
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

describe("DataViews' density no longer defaults from the theme (FUT-2886)", () => {
  it("stays 'cozy' with no theme density at all", async () => {
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

  it("stays 'cozy' under a 'compact' theme — no longer aliased to DataViews' own 'compact'", async () => {
    renderGrid("produtos", themeAt("compact"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("stays 'cozy' under a 'comfortable' theme — no longer aliased to DataViews' own 'comfortable'", async () => {
    renderGrid("produtos", themeAt("comfortable"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("stays 'cozy' for a raw numeric theme density — it names no level", async () => {
    renderGrid("produtos", createTheme({ density: resolveDensityFactor(1.5) }));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-cozy")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("lets a stored per-viewer preference win over any theme (regression guard)", async () => {
    window.localStorage.setItem(STORAGE_KEY, "comfortable");
    renderGrid("produtos", themeAt("compact"));
    await openDisplayTab("produtos");
    await waitFor(() =>
      expect(screen.getByTestId("produtos-density-comfortable")).toHaveAttribute("aria-pressed", "true"),
    );
  });
});
