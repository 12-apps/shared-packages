import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn } from "../data-views-types";
import type { SelectionExtraContext } from "../data-views-selection-extra";

/**
 * THE SELECTION-WIDENING SLOT.
 *
 * A paginated grid can only ever tick the page it is showing, so acting on
 * "everything matching the filter" needs a control that says so — and the
 * convention operators already know puts it beside the count, appearing only
 * once the whole page is ticked.
 *
 * The grid owns the half a host cannot compute: which rows the page is
 * currently rendering. These cases pin that it reports it correctly, and that
 * the slot stays out of the way the rest of the time.
 */

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "Ana" },
  { id: "2", name: "Bruno" },
  { id: "3", name: "Carla" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
];

/** The last context the slot was called with — what the host would branch on. */
function renderGrid(): { seen: SelectionExtraContext<Row>[] } {
  const seen: SelectionExtraContext<Row>[] = [];
  render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="people"
        testIdPrefix="people"
        selectionExtra={(context) => {
          seen.push(context);
          return context.allOnPageSelected ? (
            <button type="button" data-testid="people-select-all-matching">
              Selecionar todos
            </button>
          ) : null;
        }}
      />
    </ThemeProvider>,
  );
  return { seen };
}

const widening = () => screen.queryByTestId("people-select-all-matching");

/** The most recent context, asserted non-empty so a miss reads as a miss. */
function latest(seen: SelectionExtraContext<Row>[]): SelectionExtraContext<Row> {
  const last = seen[seen.length - 1];
  if (!last) throw new Error("the selection slot was never called");
  return last;
}

describe("the selection-widening slot", () => {
  it("is not called at all while nothing is selected", async () => {
    const { seen } = renderGrid();
    // Presence evidence: the grid rendered, it just has no selection yet.
    expect(screen.getByText("Ana")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).not.toBeInTheDocument());
    expect(seen).toHaveLength(0);
    await waitFor(() => expect(widening()).not.toBeInTheDocument());
  });

  it("reports a PARTIAL page as not-all, so the control can hold itself back", async () => {
    const { seen } = renderGrid();
    fireEvent.click(screen.getByLabelText("Select row 1"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-count-indicator")).toHaveTextContent("1 item selected"),
    );
    const last = latest(seen);
    expect(last.allOnPageSelected).toBe(false);
    expect(last.pageRowCount).toBe(3);
    expect(last.selectedRows.map((row) => row.id)).toEqual(["1"]);
    // The slot IS being consulted — it just chose to render nothing.
    await waitFor(() => expect(widening()).not.toBeInTheDocument());
  });

  it("reports a FULL page as all-selected, and the control appears beside the count", async () => {
    const { seen } = renderGrid();
    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() => expect(widening()).toBeInTheDocument());
    const last = latest(seen);
    expect(last.allOnPageSelected).toBe(true);
    expect(last.pageRowCount).toBe(3);
    expect(last.selectedRows).toHaveLength(3);
  });

  it("goes away again when the selection stops covering the page", async () => {
    renderGrid();
    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() => expect(widening()).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select row 2"));
    await waitFor(() => expect(widening()).not.toBeInTheDocument());
    // Still selecting — this is the partial state, not a cleared one.
    expect(screen.getByTestId("selected-count-indicator")).toHaveTextContent("2 items selected");
  });

  it("hands back a clearSelection that really clears", async () => {
    const { seen } = renderGrid();
    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() => expect(widening()).toBeInTheDocument());
    act(() => latest(seen).clearSelection());
    await waitFor(() => expect(widening()).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("selected-count-indicator")).not.toBeInTheDocument());
  });

  it("leaves the actions menu alone — the two slots are separate controls", async () => {
    const onBulk = vi.fn();
    render(
      <ThemeProvider theme={createTheme()}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={[]}
          getRowId={(row) => row.id}
          dataTestId="mixed"
          testIdPrefix="mixed"
          rowActions={[{ id: "archive", label: "Arquivar", onSelect: (r) => onBulk(r.length) }]}
          selectionExtra={({ allOnPageSelected }) =>
            allOnPageSelected ? (
              <button type="button" data-testid="mixed-widen">
                Selecionar todos
              </button>
            ) : null
          }
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Select all rows"));
    // Both are on the bar: `rowActions` short-circuits the low-level
    // `bulkActions` render prop, which is exactly why widening needed a slot
    // of its own rather than a share of that one.
    await waitFor(() => expect(screen.getByTestId("mixed-widen")).toBeInTheDocument());
    expect(screen.getByTestId("mixed-bulk-actions")).toBeInTheDocument();
  });
});
