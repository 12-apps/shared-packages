import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn, DataViewQuery, DataViewServer } from "../data-views-types";

/**
 * THE "EXIBIR" PANEL — sort, columns and format in one control.
 *
 * They were three separate toolbar dropdowns, which asked the operator to know
 * which one held what. They answer one question, so they are one panel: three
 * tabs, and nothing in it ever emits a query — every setting here is
 * presentation.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  valor: number;
  data: string;
}

const rows: Row[] = [
  { id: "1", nome: "Ana", valor: 10, data: "2026-07-01" },
  { id: "2", nome: "Bruno", valor: 25, data: "2026-07-02" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "nome", header: "Nome", accessor: "nome", searchable: true },
  { id: "valor", header: "Valor", accessor: "valor" },
  { id: "data", header: "Data", accessor: "data" },
];

function harness(): { queries: DataViewQuery[]; server: DataViewServer } {
  const queries: DataViewQuery[] = [];
  return {
    queries,
    server: {
      totalCount: 214,
      page: 1,
      pageSize: 25,
      onQueryChange: (query) => queries.push(query),
    },
  };
}

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="lista"
        testIdPrefix="lista"
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Open the panel on a given tab. */
async function openPanel(tab: "sort" | "columns" | "display"): Promise<void> {
  fireEvent.click(screen.getByTestId("lista-display-trigger"));
  fireEvent.click(await screen.findByTestId(`lista-display-tab-${tab}`));
}

/**
 * The rendered table's header cells, in order.
 *
 * Read straight off the DOM rather than through `getAllByRole`: the Exibir
 * panel is a MUI Popover, and while one is open MUI marks the rest of the app
 * `aria-hidden`, so the accessibility tree legitimately does not contain the
 * table. The assertion here is about what is RENDERED, not about what a screen
 * reader sees behind an open dialog.
 */
function headerLabels(): string[] {
  return [...document.querySelectorAll('[role="columnheader"]')]
    .map((cell) => cell.textContent?.trim() ?? "")
    .filter((label) => label !== "");
}

/**
 * A column's visibility checkbox. The testid sits on the MUI Checkbox ROOT (its
 * `inputProps` type rejects `data-testid`), so reach the real input — the same
 * way the filter-pill tests do.
 */
function columnToggle(id: string): HTMLInputElement {
  const input = screen.getByTestId(`lista-column-toggle-${id}`).querySelector("input");
  if (!input) throw new Error(`checkbox input for ${id} not found`);
  return input;
}

/** The Colunas tab's "N de M visíveis" line, re-read on every call. */
function visibleCount(): string {
  return screen.getByTestId("lista-columns-count").textContent ?? "";
}

beforeEach(() => window.localStorage.clear());

describe("the Exibir panel", () => {
  it("opens on Colunas and reports how many of the columns are visible", async () => {
    renderGrid();
    fireEvent.click(screen.getByTestId("lista-display-trigger"));
    await screen.findByTestId("lista-columns-count");
    expect(visibleCount()).toContain("3 de 3 visíveis");
  });

  it("hides a column without emitting a query — visibility is presentation", async () => {
    const { queries, server } = harness();
    renderGrid({ server });
    await openPanel("columns");

    await screen.findByTestId("lista-column-toggle-valor");
    fireEvent.click(columnToggle("valor"));

    await waitFor(() => expect(visibleCount()).toContain("2 de 3"));
    expect(headerLabels()).not.toContain("Valor");
    expect(queries).toHaveLength(0);
  });

  it("reorders columns with the move arrows, and the grid follows", async () => {
    renderGrid();
    expect(headerLabels()).toEqual(["Nome", "Valor", "Data"]);
    await openPanel("columns");

    const valorRow = await screen.findByTestId("lista-column-row-valor");
    fireEvent.click(within(valorRow).getByLabelText("Mover Valor para cima"));

    await waitFor(() => expect(headerLabels()).toEqual(["Valor", "Nome", "Data"]));
  });

  it("restores the declared order and every column with Padrão", async () => {
    renderGrid();
    await openPanel("columns");

    const dataRow = await screen.findByTestId("lista-column-row-data");
    fireEvent.click(within(dataRow).getByLabelText("Mover Data para cima"));
    await waitFor(() => expect(headerLabels()).toEqual(["Nome", "Data", "Valor"]));
    fireEvent.click(columnToggle("nome"));
    await waitFor(() => expect(headerLabels()).not.toContain("Nome"));

    fireEvent.click(screen.getByTestId("lista-columns-reset"));

    await waitFor(() => expect(headerLabels()).toEqual(["Nome", "Valor", "Data"]));
  });

  it("phrases the sort direction in the sort field's own terms", async () => {
    renderGrid({
      sortFields: [
        { value: "valor", label: "Valor" },
        { value: "data", label: "Data" },
      ],
      sortKinds: { valor: "currency", data: "date" },
    });
    await openPanel("sort");

    expect(await screen.findByTestId("lista-sort-dir-asc")).toHaveTextContent("Menor → maior");

    fireEvent.click(screen.getByTestId("lista-sort-field-data"));
    await waitFor(() =>
      expect(screen.getByTestId("lista-sort-dir-desc")).toHaveTextContent("Mais recente"),
    );
  });

  it("changes the sort through the panel and emits one query carrying it", async () => {
    const { queries, server } = harness();
    renderGrid({ server, sortFields: [{ value: "valor", label: "Valor" }] });
    await openPanel("sort");

    fireEvent.click(await screen.findByTestId("lista-sort-dir-desc"));

    await waitFor(() => expect(queries).toHaveLength(1));
    expect(queries[0]?.sortBy).toEqual([{ id: "valor", dir: "desc" }]);
  });

  it("changes the density without emitting a query", async () => {
    const { queries, server } = harness();
    renderGrid({ server });
    await openPanel("display");

    fireEvent.click(await screen.findByTestId("lista-density-comfortable"));

    await waitFor(() =>
      expect(screen.getByTestId("lista-density-comfortable")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(window.localStorage.getItem("dataviews:density")).toBe("comfortable");
    expect(queries).toHaveLength(0);
  });

  it("remembers the density across screens, like the layout", async () => {
    const first = renderGrid();
    await openPanel("display");
    fireEvent.click(await screen.findByTestId("lista-density-compact"));
    await waitFor(() => expect(window.localStorage.getItem("dataviews:density")).toBe("compact"));
    first.unmount();

    renderGrid();
    fireEvent.click(screen.getByTestId("lista-display-trigger"));
    fireEvent.click(await screen.findByTestId("lista-display-tab-display"));
    await waitFor(() =>
      expect(screen.getByTestId("lista-density-compact")).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("offers only the formats this table can render", async () => {
    renderGrid();
    await openPanel("display");

    expect(await screen.findByTestId("lista-layout-table")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("lista-layout-cards")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("lista-layout-list")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("lista-layout-board")).not.toBeInTheDocument());
  });
});
