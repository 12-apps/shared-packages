import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { groupRows, type BoardConfig } from "../DataViewsBoard";
import type { DataViewCardSelection, DataViewColumn, DataViewQuery, DataViewServer } from "../data-views-types";

/**
 * THE BOARD — a rendering of the loaded page, never a second source of truth.
 *
 * Its counts describe THIS PAGE and say so; the scope tabs above it show
 * whole-query totals. The two must never be confusable, which is why every
 * count here is asserted together with its "nesta página" label.
 */

interface Payment extends Record<string, unknown> {
  id: string;
  cliente: string;
  estado: string;
  amountCents: number;
}

const payments: Payment[] = [
  { id: "1", cliente: "Ana", estado: "pago", amountCents: 1000 },
  { id: "2", cliente: "Bruno", estado: "pago", amountCents: 2500 },
  { id: "3", cliente: "Carla", estado: "recusado", amountCents: 700 },
];

const columns: DataViewColumn<Payment>[] = [
  { id: "cliente", header: "Cliente", accessor: "cliente", searchable: true },
  { id: "estado", header: "Estado", accessor: "estado" },
];

const board: BoardConfig<Payment> = {
  groupBy: "estado",
  groups: [
    { value: "autorizado", label: "Autorizado", tone: "info" },
    { value: "pago", label: "Pago", tone: "success" },
    { value: "recusado", label: "Recusado", tone: "error" },
  ],
  sumBy: "amountCents",
  formatSum: (total) => `R$ ${(total / 100).toFixed(2)}`,
};

/** The entity's own card — the board reuses exactly what the cards layout uses. */
function renderCard(row: Payment, selection: DataViewCardSelection): React.ReactNode {
  return (
    <div data-testid={`card-${row.id}`}>
      <span>{row.cliente}</span>
      <input
        type="checkbox"
        aria-label={`Selecionar ${row.cliente}`}
        checked={selection.selected}
        onChange={selection.onToggleSelect}
      />
    </div>
  );
}

interface Harness {
  queries: DataViewQuery[];
  server: DataViewServer;
}

function harness(overrides: Partial<DataViewServer> = {}): Harness {
  const queries: DataViewQuery[] = [];
  return {
    queries,
    server: {
      totalCount: 214,
      page: 1,
      pageSize: 25,
      onQueryChange: (query) => queries.push(query),
      ...overrides,
    },
  };
}

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Payment>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Payment>
        rows={payments}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="pagamentos"
        testIdPrefix="pagamentos"
        renderCard={renderCard}
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Open "Exibir", go to the Exibição tab, and pick a format tile. */
async function switchLayout(layout: string): Promise<void> {
  fireEvent.click(screen.getByTestId("pagamentos-display-trigger"));
  fireEvent.click(await screen.findByTestId("pagamentos-display-tab-display"));
  fireEvent.click(await screen.findByTestId(`pagamentos-layout-${layout}`));
}

const column = (value: string): HTMLElement =>
  screen.getByTestId(`pagamentos-board-column-${value}`);

beforeEach(() => window.localStorage.clear());

describe("groupRows", () => {
  it("keeps the declared order, including groups with no rows", () => {
    const columnsOut = groupRows(payments, board);
    expect(columnsOut.map((col) => col.key)).toEqual(["autorizado", "pago", "recusado"]);
    expect(columnsOut[0]?.rows).toHaveLength(0);
  });

  it("collects a row in an UNDECLARED state instead of dropping it", () => {
    const contested: Payment = { id: "9", cliente: "Davi", estado: "contestado", amountCents: 100 };
    const columnsOut = groupRows([...payments, contested], board);

    const extra = columnsOut.at(-1);
    expect(extra?.key).toBe("__extra__");
    expect(extra?.rows).toEqual([contested]);
    // Nothing is lost: every input row is placed somewhere.
    expect(columnsOut.flatMap((col) => col.rows)).toHaveLength(4);
  });

  it("renders no extra column once every row is in a declared state", () => {
    expect(groupRows(payments, board).map((col) => col.key)).not.toContain("__extra__");
  });
});

describe("DataViews board layout", () => {
  it("is not offered when no board config is supplied", async () => {
    renderGrid();
    fireEvent.click(screen.getByTestId("pagamentos-display-trigger"));
    fireEvent.click(await screen.findByTestId("pagamentos-display-tab-display"));
    // The panel opened and offers Grade — so "no Quadro" is a real absence,
    // not a not-yet-rendered panel.
    expect(await screen.findByTestId("pagamentos-layout-cards")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("pagamentos-layout-board")).not.toBeInTheDocument());
  });

  it("is not offered — and throws nothing — when a board config has no renderCard", async () => {
    renderGrid({ board, renderCard: undefined });
    fireEvent.click(screen.getByTestId("pagamentos-display-trigger"));
    fireEvent.click(await screen.findByTestId("pagamentos-display-tab-display"));
    // Only the table is renderable, so it is the only format offered.
    expect(await screen.findByTestId("pagamentos-layout-table")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("pagamentos-layout-board")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("pagamentos-layout-cards")).not.toBeInTheDocument());
  });

  it("distributes the loaded page into columns and emits NO query", async () => {
    const { queries, server } = harness();
    renderGrid({ board, server });

    await switchLayout("board");

    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    expect(within(column("pago")).getByTestId("card-1")).toBeInTheDocument();
    expect(within(column("pago")).getByTestId("card-2")).toBeInTheDocument();
    expect(within(column("recusado")).getByTestId("card-3")).toBeInTheDocument();
    expect(queries).toHaveLength(0);
  });

  it("labels its counts as counts of the loaded page, not whole-query totals", async () => {
    // 3 rows loaded, totalCount 214 — the columns must total 3 and say so.
    const { server } = harness();
    renderGrid({ board, server });

    await switchLayout("board");

    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    expect(screen.getByTestId("pagamentos-board-column-pago-count")).toHaveTextContent("2 nesta página");
    expect(screen.getByTestId("pagamentos-board-column-recusado-count")).toHaveTextContent("1 nesta página");
    expect(screen.getByTestId("pagamentos-board-scale-note")).toHaveTextContent(
      /apenas aos itens desta página/,
    );
  });

  it("renders an empty declared column, in position, saying it is empty", async () => {
    renderGrid({ board, server: harness().server });
    await switchLayout("board");

    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    expect(screen.getByTestId("pagamentos-board-column-autorizado-count")).toHaveTextContent("0 nesta página");
    expect(screen.getByTestId("pagamentos-board-column-autorizado-empty")).toBeInTheDocument();
  });

  it("sums each column over its loaded rows, with the page's own formatter", async () => {
    renderGrid({ board, server: harness().server });
    await switchLayout("board");

    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    expect(screen.getByTestId("pagamentos-board-column-pago-sum")).toHaveTextContent("R$ 35.00");
    expect(screen.getByTestId("pagamentos-board-column-recusado-sum")).toHaveTextContent("R$ 7.00");
  });

  it("keeps a row in an undeclared state visible and selectable", async () => {
    const contested: Payment = { id: "9", cliente: "Davi", estado: "contestado", amountCents: 100 };
    renderGrid({ board, rows: [...payments, contested], server: harness().server });

    await switchLayout("board");

    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    const extra = screen.getByTestId("pagamentos-board-column-__extra__");
    expect(within(extra).getByTestId("card-9")).toBeInTheDocument();
    fireEvent.click(within(extra).getByLabelText("Selecionar Davi"));
    await waitFor(() =>
      expect(within(extra).getByLabelText("Selecionar Davi")).toBeChecked(),
    );
  });

  it("shares one selection with the table and the cards", async () => {
    renderGrid({ board, server: harness().server });
    await switchLayout("board");
    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());

    fireEvent.click(within(column("pago")).getByLabelText("Selecionar Ana"));
    await waitFor(() => expect(screen.getByTestId("pagamentos-clear-all")).toBeInTheDocument());

    await switchLayout("cards");

    await waitFor(() => expect(screen.getByTestId("pagamentos-cards")).toBeInTheDocument());
    expect(screen.getByLabelText("Selecionar Ana")).toBeChecked();
    expect(screen.getByLabelText("Selecionar Bruno")).not.toBeChecked();
  });

  it("shows the zoom slider on the board, since the board reuses the card", async () => {
    renderGrid({ board, server: harness().server });
    await switchLayout("board");
    await waitFor(() => expect(screen.getByTestId("pagamentos-card-zoom")).toBeInTheDocument());
  });
});
