import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { BaseCard } from "../base-card";
import { BaseListCard } from "../base-list-card";
import type { DataViewCardSelection, DataViewColumn, FilterFieldConfig } from "../data-views-types";

/**
 * `selectable={false}` — A GRID WITH NO ROW SELECTION.
 *
 * A screen whose last bulk action is gone still drew a checkbox on every row,
 * and ticking one handed the whole toolbar line to the selection
 * (`exclusiveSelection`): the search, the filter pills and Exportar vanished,
 * and nothing was offered in their place. A control whose only effect is to
 * take the toolbar away is a defect, so the grid can now be told there is no
 * selection at all — in every layout — while row click and the row menu keep
 * working. The default (`true`) is today's grid, unchanged.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", nome: "Ana", status: "ACTIVE" },
  { id: "2", nome: "Bruno", status: "INACTIVE" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "nome", header: "Nome", accessor: "nome", searchable: true },
  { id: "status", header: "Status", accessor: "status" },
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

/** The real tile, wired the way every entity card is: the toggle passed on as-is. */
function renderCard(row: Row, selection: DataViewCardSelection): React.ReactNode {
  return (
    <BaseCard
      title={row.nome}
      testId={`card-${row.id}`}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
    />
  );
}

/** The real list row, wired the same way. */
function renderListRow(row: Row, selection: DataViewCardSelection): React.ReactNode {
  return (
    <BaseListCard
      title={row.nome}
      testId={`row-${row.id}`}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
    />
  );
}

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={fields}
        getRowId={(row) => row.id}
        dataTestId="pedidos"
        testIdPrefix="pedidos"
        inlineFilters
        alwaysShowSearch
        exportConfig={{ onExport: vi.fn() }}
        renderCard={renderCard}
        renderListRow={renderListRow}
        ignoreStoredLayout
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Every checkbox the grid body draws (the toolbar's filter controls excluded). */
function bodyCheckboxes(scope: HTMLElement): HTMLElement[] {
  return within(scope).queryAllByRole("checkbox");
}

beforeEach(() => window.localStorage.clear());

describe("DataViews with selectable={false}", () => {
  it("draws no checkbox column in the table — no select-all, no row box, no reserved cell", async () => {
    renderGrid({ selectable: false });
    const table = screen.getByTestId("pedidos");
    expect(within(table).getByText("Ana")).toBeInTheDocument();
    await waitFor(() => expect(within(table).queryByLabelText("Selecionar todas as linhas")).toBeNull());
    expect(bodyCheckboxes(table)).toHaveLength(0);
    // The column's width is not held either: no `padding="checkbox"` cell at all.
    expect(table.querySelectorAll(".MuiTableCell-paddingCheckbox")).toHaveLength(0);
  });

  it("draws no checkbox on cards and no select-all strip above them", async () => {
    renderGrid({ selectable: false, defaultLayout: "cards" });
    const cards = screen.getByTestId("pedidos-cards");
    expect(within(cards).getByText("Ana")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("card-1-checkbox")).toBeNull());
    expect(bodyCheckboxes(cards)).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId("pedidos-select-all-strip")).toBeNull());
  });

  it("draws no checkbox, and no empty slot for one, on list rows", async () => {
    renderGrid({ selectable: false, defaultLayout: "list" });
    const list = screen.getByTestId("pedidos-list");
    expect(within(list).getByText("Bruno")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("row-1-checkbox")).toBeNull());
    expect(bodyCheckboxes(list)).toHaveLength(0);
    await waitFor(() => expect(list.querySelector('[data-slot="select"]')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("pedidos-select-all-strip")).toBeNull());
  });

  it("draws no checkbox in a list with shared columns (the group reserves no select gutter)", () => {
    renderGrid({
      selectable: false,
      defaultLayout: "list",
      listGroup: { cells: [{ id: "nome", primary: (row: Row) => row.nome }] },
    });
    const list = screen.getByTestId("pedidos-list");
    expect(within(list).getByText("Ana")).toBeInTheDocument();
    expect(bodyCheckboxes(list)).toHaveLength(0);
  });

  it("keeps the search, the filter pills and Exportar on the toolbar, with no selection count", async () => {
    renderGrid({ selectable: false });
    expect(screen.getByTestId("pedidos-search-all")).toBeInTheDocument();
    expect(screen.getByTestId("pedidos-filter-status")).toBeInTheDocument();
    expect(screen.getByTestId("pedidos-export-trigger")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).toBeNull());
  });

  it("still opens a row on click, and still renders the row menu", async () => {
    const onRowClick = vi.fn();
    const onMenu = vi.fn();
    renderGrid({
      selectable: false,
      onRowClick,
      renderRowMenu: (row) => (
        <button type="button" data-testid={`menu-${row.id}`} onClick={() => onMenu(row.id)}>
          ⋮
        </button>
      ),
    });
    fireEvent.click(screen.getByText("Ana"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(screen.getByTestId("menu-2"));
    expect(onMenu).toHaveBeenCalledWith("2");
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).toBeNull());
  });
});

describe("DataViews by default (selectable)", () => {
  it("keeps the table's checkbox column, and ticking a row still takes the toolbar", async () => {
    renderGrid();
    const table = screen.getByTestId("pedidos");
    expect(within(table).getByLabelText("Selecionar todas as linhas")).toBeInTheDocument();
    fireEvent.click(within(table).getByLabelText("Selecionar todas as linhas"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-count-indicator")).toHaveTextContent("2 selecionados"),
    );
    // `exclusiveSelection`: the browsing controls give way to the selection.
    await waitFor(() => expect(screen.queryByTestId("pedidos-search-all")).toBeNull());
  });

  it("keeps the card checkbox and the select-all strip", () => {
    renderGrid({ defaultLayout: "cards" });
    expect(screen.getByTestId("card-1-checkbox")).toBeInTheDocument();
    expect(screen.getByTestId("pedidos-select-all-strip")).toBeInTheDocument();
  });

  it("keeps the list-row checkbox", () => {
    renderGrid({ defaultLayout: "list" });
    expect(screen.getByTestId("row-1-checkbox")).toBeInTheDocument();
    expect(screen.getByTestId("pedidos-select-all-strip")).toBeInTheDocument();
  });
});
