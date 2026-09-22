import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn } from "../data-views-types";
import type { DataViewRowDetail } from "../data-views-row-detail";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  paid: boolean;
}

const rows: Row[] = [
  { id: "1", name: "Ana", paid: true },
  { id: "2", name: "Bruno", paid: false },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
];

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="people"
        testIdPrefix="people"
        {...props}
      />
    </ThemeProvider>,
  );
}

/** The table row that carries a person's name. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

const detail: DataViewRowDetail<Row> = {
  render: (row) => <span data-testid={`detail-${row.id}`}>detalhe de {row.name}</span>,
  isExpandable: (row) => row.paid,
};

describe("DataViewsGrid rowDetail", () => {
  beforeEach(() => window.localStorage.clear());

  it("draws no chevron at all without a rowDetail", () => {
    renderGrid();
    expect(screen.queryAllByRole("button", { name: "Expandir detalhes" })).toHaveLength(0);
  });

  it("offers the chevron only on the rows isExpandable accepts", () => {
    renderGrid({ rowDetail: detail });
    expect(within(rowOf("Ana")).getByRole("button", { name: "Expandir detalhes" })).toBeVisible();
    expect(within(rowOf("Bruno")).queryAllByRole("button", { name: "Expandir detalhes" })).toHaveLength(0);
  });

  it("opens the detail under the row, and closes it again", () => {
    renderGrid({ rowDetail: detail });
    const toggle = within(rowOf("Ana")).getByRole("button", { name: "Expandir detalhes" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByTestId("detail-1")).toHaveTextContent("detalhe de Ana");
    const collapse = within(rowOf("Ana")).getByRole("button", { name: "Recolher detalhes" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(screen.queryAllByTestId("detail-1")).toHaveLength(0);
  });

  it("does not fire the row click when the chevron is pressed", () => {
    const onRowClick = vi.fn();
    renderGrid({ rowDetail: detail, onRowClick });
    fireEvent.click(within(rowOf("Ana")).getByRole("button", { name: "Expandir detalhes" }));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("detail-1")).toBeVisible();
  });

  it("offers every row when isExpandable is omitted", () => {
    renderGrid({ rowDetail: { render: detail.render } });
    expect(screen.getAllByRole("button", { name: "Expandir detalhes" })).toHaveLength(2);
  });
});
