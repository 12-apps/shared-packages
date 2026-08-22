import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn, FilterFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Ana", status: "ACTIVE" },
  { id: "2", name: "Bruno", status: "INACTIVE" },
  { id: "3", name: "Carla", status: "ACTIVE" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
  { id: "status", header: "Status", accessor: "status", searchable: true },
  { id: "actions", header: "", type: "actions", hideable: false, cell: () => null },
];

const fields: FilterFieldConfig<Row>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "ACTIVE", label: "Ativo" },
      { value: "INACTIVE", label: "Inativo" },
    ],
  },
];

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={fields}
        getRowId={(row) => row.id}
        dataTestId="people"
        testIdPrefix="people"
        {...props}
      />
    </ThemeProvider>,
  );
}

const counter = (): string => screen.getByTestId("people-counter").textContent ?? "";

/** The panel keeps its fields mounted (visibility-hidden when closed), so they
 *  stay interactable in tests. Query the input directly — `getByRole` would skip
 *  the hidden panel. */
function statusCheckbox(value: string): HTMLInputElement {
  const input = screen.getByTestId(`people-filter-status-${value}`).querySelector("input");
  if (!input) throw new Error(`checkbox input for ${value} not found`);
  return input;
}

describe("DataViewsGrid", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders every row and a matched/total counter", () => {
    renderGrid();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(counter()).toContain("3 de 3");
  });

  it("narrows via the keyword search (commit on blur) and updates the counter", async () => {
    renderGrid();
    const search = screen.getByTestId("people-search-all");
    fireEvent.change(search, { target: { value: "car" } });
    fireEvent.blur(search);
    await waitFor(() => expect(screen.queryByText("Ana")).not.toBeInTheDocument());
    expect(screen.getByText("Carla")).toBeInTheDocument();
    expect(counter()).toContain("1 de 3");
  });

  it("applies a checkbox filter field and updates the counter", async () => {
    renderGrid();
    fireEvent.click(statusCheckbox("INACTIVE"));
    await waitFor(() => expect(screen.queryByText("Ana")).not.toBeInTheDocument());
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(counter()).toContain("1 de 3");
  });

  it("reports state changes and re-applies a supplied view state", async () => {
    const onStateChange = vi.fn();
    const { rerender } = renderGrid({ onStateChange });
    expect(onStateChange).toHaveBeenCalled();

    rerender(
      <ThemeProvider theme={createTheme()}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          dataTestId="people"
          testIdPrefix="people"
          onStateChange={onStateChange}
          appliedState={{ search: "", pills: { status: ["ACTIVE"] }, sortBy: [], visibleColumns: ["name", "status", "actions"] }}
        />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.queryByText("Bruno")).not.toBeInTheDocument());
    expect(counter()).toContain("2 de 3");
  });

  it("syncState re-applies the URL controls on change while preserving hidden columns", async () => {
    // A stable appliedState hides the `status` column; only `syncState` changes
    // between renders (as a URL back/forward would), so the appliedState effect
    // never re-fires and we isolate the syncState merge.
    const applied = { search: "", pills: {}, sortBy: [], visibleColumns: ["name", "actions"] };
    const { rerender } = renderGrid({
      appliedState: applied,
      syncState: { search: "", pills: {}, ranges: {}, sortBy: [] },
    });
    // `name` header present (evidence the grid rendered) but `status` is hidden.
    expect(screen.getByRole("columnheader", { name: "Nome" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument(),
    );
    expect(counter()).toContain("3 de 3");

    // A new syncState reference applies a status filter (e.g. browser back/forward).
    rerender(
      <ThemeProvider theme={createTheme()}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          dataTestId="people"
          testIdPrefix="people"
          appliedState={applied}
          syncState={{ search: "", pills: { status: ["ACTIVE"] }, ranges: {}, sortBy: [] }}
        />
      </ThemeProvider>,
    );

    // The filter re-applied (Bruno is INACTIVE)...
    await waitFor(() => expect(screen.queryByText("Bruno")).not.toBeInTheDocument());
    expect(counter()).toContain("2 de 3");
    // ...and the user's hidden `status` column was NOT resurrected by the re-sync.
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument(),
    );
  });

  it("the funnel toggle opens/closes the filter panel", async () => {
    renderGrid();
    const funnel = screen.getByTestId("people-filters-toggle");
    expect(funnel).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(funnel);
    await waitFor(() => expect(funnel).toHaveAttribute("aria-expanded", "true"));
    // Counter stays visible in the toolbar regardless of panel state.
    expect(screen.getByTestId("people-counter")).toBeInTheDocument();
    fireEvent.click(funnel);
    await waitFor(() => expect(funnel).toHaveAttribute("aria-expanded", "false"));
  });

  it("selects all rows, shows the count, and renders the bulk action", async () => {
    const onBulk = vi.fn();
    renderGrid({
      bulkActions: (selected, clear) => (
        <button
          type="button"
          data-testid="people-bulk"
          onClick={() => {
            onBulk(selected.length);
            clear();
          }}
        >
          Bulk {selected.length}
        </button>
      ),
    });
    // No selection: no count indicator, no bulk action.
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-count-indicator")).toHaveTextContent("3 items selected"),
    );
    const bulk = screen.getByTestId("people-bulk");
    fireEvent.click(bulk);
    expect(onBulk).toHaveBeenCalledWith(3);
    // Bulk action clears the selection.
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).not.toBeInTheDocument());
  });

  it("drives the row kebab AND the bulk menu from one rowActions list", async () => {
    const onArchive = vi.fn();
    const onEdit = vi.fn();
    renderGrid({
      // No actions column here so the grid appends its auto kebab from rowActions.
      columns: [
        { id: "name", header: "Nome", accessor: "name", searchable: true },
        { id: "status", header: "Status", accessor: "status" },
      ],
      rowActions: [
        // `bulk: false` → appears in the kebab but NOT the bulk menu.
        { id: "edit", label: "Editar", bulk: false, onSelect: (r) => onEdit(r.length) },
        { id: "archive", label: "Arquivar", color: "danger", onSelect: (r) => onArchive(r.length) },
      ],
    });

    // Per-row kebab: both actions present; Editar acts on the single row.
    fireEvent.click(screen.getByTestId("people-actions-1"));
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("Arquivar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Editar"));
    expect(onEdit).toHaveBeenCalledWith(1);

    // Select all → the bulk "Ações" menu shows only the bulk-eligible action.
    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() => expect(screen.getByTestId("people-bulk-actions")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("people-bulk-actions"));
    await waitFor(() => expect(screen.getByText("Arquivar")).toBeInTheDocument());
    // "Editar" is single-item only, so it must NOT appear in the bulk menu.
    await waitFor(() => expect(screen.queryByText("Editar")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Arquivar"));
    expect(onArchive).toHaveBeenCalledWith(3);
  });

  it("re-emits visible rows on a same-id content change, but not on a content-equal rerender", async () => {
    // Local seed (not the shared module `rows`) so this test owns its data.
    const seed: Row[] = [
      { id: "1", name: "Ana", status: "ACTIVE" },
      { id: "2", name: "Bruno", status: "INACTIVE" },
    ];
    const onVisibleRowsChange = vi.fn<(rows: Row[]) => void>();
    const { rerender } = renderGrid({ onVisibleRowsChange, rows: seed });
    await waitFor(() => expect(onVisibleRowsChange).toHaveBeenCalled());
    const afterInitial = onVisibleRowsChange.mock.calls.length;

    const rerenderWith = (next: Row[]): void =>
      rerender(
        <ThemeProvider theme={createTheme()}>
          <DataViewsGrid<Row>
            rows={next}
            columns={columns}
            fields={fields}
            getRowId={(row) => row.id}
            dataTestId="people"
            testIdPrefix="people"
            onVisibleRowsChange={onVisibleRowsChange}
          />
        </ThemeProvider>,
      );

    // Fresh array + row refs, identical values → no re-emit (guards the loop).
    rerenderWith(seed.map((row) => ({ ...row })));
    expect(onVisibleRowsChange.mock.calls.length).toBe(afterInitial);

    // Same ids, changed values → must re-emit so the export isn't stale.
    rerenderWith(seed.map((row) => (row.id === "1" ? { ...row, name: "Ana Editada" } : { ...row })));
    await waitFor(() =>
      expect(onVisibleRowsChange.mock.calls.length).toBeGreaterThan(afterInitial),
    );
    const emitted = onVisibleRowsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(emitted.find((row) => row.id === "1")?.name).toBe("Ana Editada");
  });
});
