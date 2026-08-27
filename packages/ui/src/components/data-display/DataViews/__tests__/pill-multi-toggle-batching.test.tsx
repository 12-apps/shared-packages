/**
 * Several pill values changed in ONE tick must all survive.
 *
 * `onTogglePill` is deliberately the only channel a filter control has, so a
 * control that changes a whole selection at once emits one call per changed
 * value — `emitPillDiff` does exactly that for the category tree. The handler
 * built each patch from the RENDER'S state snapshot, so every call in a tick
 * read the same `pills` and the last write won: tick two subcategories, press
 * Apply, and one of them silently never reached the query.
 *
 * Pre-existing since the grid was imported, and reachable without any of the
 * parent-selection work — which is why the leaf-only case below is the one
 * that states the bug.
 */
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { describe, expect, it, vi } from "vitest";

import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";

import { DataViewsTableBase } from "../DataViewsTableBase";
import type {
  DataViewColumn,
  DataViewPersistence,
  DataViewRouter,
  FilterFieldConfig,
} from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  categoria: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Água com gás", categoria: "beb-agua" },
  { id: "2", name: "Guaraná", categoria: "beb-refri" },
  { id: "3", name: "Pão", categoria: "padaria" },
];

const COLUMNS: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
];

const persistence: DataViewPersistence = {
  create: vi.fn(async () => ({ ok: true as const })),
  update: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const })),
};
const router: DataViewRouter = { syncViewParam: vi.fn(), refresh: vi.fn() };

const OPTIONS = [
  { value: "beb", label: "Bebidas", parentId: null },
  { value: "beb-agua", label: "Águas", parentId: "beb" },
  { value: "beb-refri", label: "Refrigerantes", parentId: "beb" },
];

function renderGrid(allowParentSelection: boolean): ReturnType<typeof vi.fn> {
  const onQueryChange = vi.fn();
  const field: FilterFieldConfig<Row> = {
    id: "categoria",
    label: "Categoria",
    control: "category",
    options: OPTIONS,
    accessor: (row) => row.categoria,
    ...(allowParentSelection ? { allowParentSelection: true } : {}),
  };
  render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsTableBase<Row>
        persistence={persistence}
        router={router}
        rows={ROWS}
        columns={COLUMNS}
        fields={[field]}
        getRowId={(row) => row.id}
        views={[]}
        dataTestId="grid"
        testIdPrefix="grid"
        inlineFilters
        server={{ totalCount: ROWS.length, page: 1, pageSize: 20, onQueryChange }}
      />
    </ThemeProvider>,
  );
  return onQueryChange;
}

/** The `categoria` pill values of the most recent emitted query. */
function lastPills(onQueryChange: ReturnType<typeof vi.fn>): string[] | undefined {
  const calls = onQueryChange.mock.calls;
  const last = calls.at(-1)?.[0] as { pills?: Record<string, string[]> } | undefined;
  return last?.pills?.categoria;
}

describe("a pill changing several values in one tick", () => {
  it("keeps BOTH subcategories ticked individually (leaf-only, no parent selection)", async () => {
    const onQueryChange = renderGrid(false);
    fireEvent.click(screen.getByTestId("grid-filter-categoria-trigger"));

    // Two leaves, ticked into the draft, published by ONE Apply → two calls.
    fireEvent.click(screen.getByTestId("grid-filter-categoria-option-beb-agua"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-option-beb-refri"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-apply"));

    await waitFor(() => {
      expect(lastPills(onQueryChange)?.slice().sort()).toEqual(["beb-agua", "beb-refri"]);
    });
  });

  it("keeps every child when a father category is ticked", async () => {
    const onQueryChange = renderGrid(true);
    fireEvent.click(screen.getByTestId("grid-filter-categoria-trigger"));

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-beb"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-apply"));

    await waitFor(() => {
      expect(lastPills(onQueryChange)?.slice().sort()).toEqual(["beb-agua", "beb-refri"]);
    });
  });

  it("clears every child when a fully-ticked father is unticked", async () => {
    const onQueryChange = renderGrid(true);
    fireEvent.click(screen.getByTestId("grid-filter-categoria-trigger"));

    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-beb"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-apply"));
    await waitFor(() => {
      expect(lastPills(onQueryChange)?.length).toBe(2);
    });

    fireEvent.click(screen.getByTestId("grid-filter-categoria-trigger"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-category-beb"));
    fireEvent.click(screen.getByTestId("grid-filter-categoria-apply"));

    // Both removals land, not just the last one.
    await waitFor(() => {
      expect(lastPills(onQueryChange) ?? []).toEqual([]);
    });
  });
});
