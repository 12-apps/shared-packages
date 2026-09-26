import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { resolveDensityFactor } from "../../../tokens/density";
import { PT_BR_DATA_VIEWS_COPY } from "../../../pt-BR";
import { DataViewsCopyProvider } from "./data-views-copy-context";
import { DataViewsGrid } from "./DataViewsGrid";
import type { DataViewColumn } from "./data-views-types";

/**
 * `DATAVIEWS` DEFAULTS ITS DENSITY FROM THE THEME (FUT-2769).
 *
 * `DataViewsDensity`'s three names ('compact' | 'cozy' | 'comfortable') are
 * not the theme's ('compact' | 'normal' | 'comfortable'), so the default goes
 * through an alias table (`mapThemeToDataViewsDensity`,
 * `data-views-layout-context.tsx`). The STORED per-viewer preference
 * (`localStorage['dataviews:density']`) still wins over it — unchanged from
 * today, only the app-level constant is new.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
}

const rows: Row[] = [
  { id: "1", nome: "Ana" },
  { id: "2", nome: "Bruno" },
];
const columns: DataViewColumn<Row>[] = [{ id: "nome", header: "Nome", accessor: "nome", searchable: true }];

/** One screen, themed at a given density, with nothing pre-wired but the copy. */
function Screen({ prefix, theme }: { prefix: string; theme: ReturnType<typeof createTheme> }) {
  return (
    <ThemeProvider theme={theme}>
      <DataViewsCopyProvider copy={PT_BR_DATA_VIEWS_COPY}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={[]}
          getRowId={(row) => row.id}
          dataTestId={prefix}
          testIdPrefix={prefix}
        />
      </DataViewsCopyProvider>
    </ThemeProvider>
  );
}

/** The panel is a MUI `Popover` — it portals to `document.body`, not `canvasElement`. */
const body = (): ReturnType<typeof within> => within(document.body);

/** Open "Exibir", go to the Exibição tab, where the density tiles live. */
async function openDisplayTab(canvas: ReturnType<typeof within>, prefix: string): Promise<void> {
  await userEvent.click(canvas.getByTestId(`${prefix}-display-trigger`));
  await userEvent.click(await body().findByTestId(`${prefix}-display-tab-display`));
}

const meta: Meta = {
  title: "Dashboards/DataViewsTable/Tests",
  parameters: {
    layout: "padded",
    chromatic: { disableSnapshot: false },
  },
  tags: ["autodocs", "test", "component:DataViews"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const ThemeDensityDefault: Story = {
  name: "Test: Theme-driven density default",
  render: () => <Screen prefix="theme-density" theme={createTheme({ density: resolveDensityFactor("compact") })} />,
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step("Renders at the theme's compact default — nothing stored for this viewer", async () => {
      await openDisplayTab(canvas, "theme-density");
      await waitFor(() =>
        expect(body().getByTestId("theme-density-density-compact")).toHaveAttribute("aria-pressed", "true"),
      );
    });
  },
};

export const StoredPreferenceWinsOverTheme: Story = {
  name: "Test: Stored preference still wins over the theme",
  render: () => <Screen prefix="stored-density" theme={createTheme({ density: resolveDensityFactor("compact") })} />,
  play: async ({ canvasElement, step }) => {
    window.localStorage.setItem("dataviews:density", "comfortable");
    const canvas = within(canvasElement);
    try {
      await step("Renders the REMEMBERED density, not the theme's compact default", async () => {
        await openDisplayTab(canvas, "stored-density");
        await waitFor(() =>
          expect(body().getByTestId("stored-density-density-comfortable")).toHaveAttribute(
            "aria-pressed",
            "true",
          ),
        );
      });
    } finally {
      window.localStorage.removeItem("dataviews:density");
    }
  },
};
