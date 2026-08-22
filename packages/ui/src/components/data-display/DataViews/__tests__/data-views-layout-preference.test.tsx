import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { BoardConfig } from "../DataViewsBoard";
import type { DataViewCardSelection, DataViewColumn } from "../data-views-types";

/**
 * THE LAYOUT PREFERENCE — one remembered choice, shared by every screen.
 *
 * Picking "Grade" on one list is a statement about how this operator likes to
 * read lists, not about that one screen, so it is stored under a single key and
 * every other DataViews table opens in it. A screen that CANNOT render the
 * remembered layout falls back to the table WITHOUT forgetting the preference —
 * so the next screen that can render it still does.
 */

const STORAGE_KEY = "dataviews:layout";

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  estado: string;
}

const rows: Row[] = [
  { id: "1", nome: "Ana", estado: "pago" },
  { id: "2", nome: "Bruno", estado: "recusado" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "nome", header: "Nome", accessor: "nome", searchable: true },
];

const board: BoardConfig<Row> = {
  groupBy: "estado",
  groups: [
    { value: "pago", label: "Pago" },
    { value: "recusado", label: "Recusado" },
  ],
};

function renderCard(row: Row, selection: DataViewCardSelection): React.ReactNode {
  return (
    <div data-testid={`card-${row.id}`}>
      {row.nome}
      <input
        type="checkbox"
        aria-label={`Selecionar ${row.nome}`}
        checked={selection.selected}
        onChange={selection.onToggleSelect}
      />
    </div>
  );
}

/** The "Lista" row: full width, entity-rendered — the FUT-733 shape. */
function renderListRow(row: Row, selection: DataViewCardSelection): React.ReactNode {
  return (
    <div data-testid={`row-${row.id}`}>
      <span>{row.nome}</span>
      <input
        type="checkbox"
        aria-label={`Selecionar ${row.nome}`}
        checked={selection.selected}
        onChange={selection.onToggleSelect}
      />
    </div>
  );
}

/** One screen. `prefix` distinguishes tables so a second render is a second screen. */
function renderScreen(
  prefix: string,
  props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {},
) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId={prefix}
        testIdPrefix={prefix}
        renderCard={renderCard}
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Open "Exibir", go to the Exibição tab, and pick a format tile. */
async function switchLayout(prefix: string, layout: string): Promise<void> {
  fireEvent.click(screen.getByTestId(`${prefix}-display-trigger`));
  fireEvent.click(await screen.findByTestId(`${prefix}-display-tab-display`));
  fireEvent.click(await screen.findByTestId(`${prefix}-layout-${layout}`));
}

beforeEach(() => window.localStorage.clear());

describe("the remembered layout preference", () => {
  it("defaults to the table when nothing has been chosen", async () => {
    renderScreen("produtos");
    expect(screen.getByTestId("produtos-container")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("produtos-cards")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("stores the choice when the operator picks a layout", async () => {
    renderScreen("produtos");
    await switchLayout("produtos", "cards");
    await waitFor(() => expect(screen.getByTestId("produtos-cards")).toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("cards");
  });

  it("opens a DIFFERENT screen in the remembered layout", async () => {
    const first = renderScreen("produtos");
    await switchLayout("produtos", "cards");
    await waitFor(() => expect(screen.getByTestId("produtos-cards")).toBeInTheDocument());
    first.unmount();

    // A second screen, mounted fresh — the operator's choice travels with them.
    renderScreen("fornecedores");
    expect(screen.getByTestId("fornecedores-cards")).toBeInTheDocument();
  });

  it("offers Lista only when a renderListRow is supplied, and remembers it", async () => {
    const first = renderScreen("pedidos", { renderListRow });
    await switchLayout("pedidos", "list");

    await waitFor(() => expect(screen.getByTestId("pedidos-list")).toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("list");
    // A full-width row has no card size to multiply, so the zoom slider is out.
    await waitFor(() => expect(screen.queryByTestId("pedidos-card-zoom")).not.toBeInTheDocument());
    first.unmount();

    // The next screen with a list renderer opens straight into it…
    const second = renderScreen("carrinhos", { renderListRow });
    expect(screen.getByTestId("carrinhos-list")).toBeInTheDocument();
    second.unmount();

    // …and one WITHOUT falls back to the table, keeping the preference.
    renderScreen("fornecedores");
    await waitFor(() => expect(screen.queryByTestId("fornecedores-list")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("list");
  });

  it("does not offer Lista to a table that declares no row renderer", async () => {
    renderScreen("produtos");
    fireEvent.click(screen.getByTestId("produtos-display-trigger"));
    fireEvent.click(await screen.findByTestId("produtos-display-tab-display"));
    expect(await screen.findByTestId("produtos-layout-cards")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("produtos-layout-list")).not.toBeInTheDocument());
  });

  it("remembers the board too", async () => {
    const first = renderScreen("pagamentos", { board });
    await switchLayout("pagamentos", "board");
    await waitFor(() => expect(screen.getByTestId("pagamentos-board")).toBeInTheDocument());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("board");
    first.unmount();

    renderScreen("estoque", { board });
    expect(screen.getByTestId("estoque-board")).toBeInTheDocument();
  });

  it("falls back to the table on a screen that cannot render the remembered layout", async () => {
    window.localStorage.setItem(STORAGE_KEY, "board");

    // This screen declares no board — it must not try to render one.
    renderScreen("fornecedores");

    expect(screen.getByTestId("fornecedores-container")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("fornecedores-board")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("fornecedores-cards")).not.toBeInTheDocument());
    // …and the preference SURVIVES, so the next screen that has a board uses it.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("board");
  });

  it("ignores a stored value this build does not know", async () => {
    window.localStorage.setItem(STORAGE_KEY, "kanban-3d");
    renderScreen("produtos");
    expect(screen.getByTestId("produtos-container")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("produtos-cards")).not.toBeInTheDocument());
  });

  it("lets an explicit defaultLayout win when nothing is remembered", () => {
    renderScreen("produtos", { defaultLayout: "cards" });
    expect(screen.getByTestId("produtos-cards")).toBeInTheDocument();
  });

  it("prefers the remembered choice over the page's defaultLayout", async () => {
    window.localStorage.setItem(STORAGE_KEY, "table");
    renderScreen("produtos", { defaultLayout: "cards" });
    expect(screen.getByTestId("produtos-container")).toBeInTheDocument();
    // The operator said "table" out loud; a page default is only a default.
    await waitFor(() => expect(screen.queryByTestId("produtos-cards")).not.toBeInTheDocument());
  });
});
