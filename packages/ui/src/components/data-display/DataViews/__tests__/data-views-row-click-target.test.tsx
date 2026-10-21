import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn } from "../data-views-types";

/**
 * Where a click opens the row (FUT-3849).
 *
 * The row-open handler lived on a Box INSIDE each cell, so the cell's own
 * padding — 16px either side of every column — showed the row's hover and did
 * nothing on click. A host layout change moved the row's centre into one of
 * those strips and an admin e2e went red on a click that "succeeded". So the
 * target is the cell itself, padding included, and never the actions column.
 */

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Ana", status: "Pago" },
  { id: "2", name: "Bruno", status: "Aberto" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name" },
  { id: "status", header: "Situação", accessor: "status" },
  { id: "actions", header: "", type: "actions", hideable: false, cell: () => <button type="button">⋮</button> },
];

function renderGrid(onRowClick: (row: Row) => void) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="people"
        testIdPrefix="people"
        onRowClick={onRowClick}
      />
    </ThemeProvider>,
  );
}

/** The `<td>` itself, not its content: a click here is a click on the padding. */
function cellOf(text: string): HTMLElement {
  const cell = screen.getByText(text).closest<HTMLElement>('[data-slot="cell"]');
  if (!cell) throw new Error(`no cell for ${text}`);
  return cell;
}

describe("DataViewsGrid row click target (FUT-3849)", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens the row from the cell's own padding, not only its content", () => {
    const onRowClick = vi.fn();
    renderGrid(onRowClick);
    fireEvent.click(cellOf("Pago"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("opens the row from every cell but the actions one", () => {
    const onRowClick = vi.fn();
    renderGrid(onRowClick);
    for (const text of ["Ana", "Pago", "Bruno", "Aberto"]) fireEvent.click(cellOf(text));
    expect(onRowClick.mock.calls.map(([row]) => (row as Row).id)).toEqual(["1", "1", "2", "2"]);

    onRowClick.mockClear();
    const actions = document.querySelectorAll<HTMLElement>('[data-slot="cell"][data-col-id="actions"]');
    expect(actions).toHaveLength(2);
    actions.forEach((cell) => fireEvent.click(cell));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("opens the row once for a click on its content", () => {
    const onRowClick = vi.fn();
    renderGrid(onRowClick);
    fireEvent.click(screen.getByText("Ana"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});
