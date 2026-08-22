import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewExportRequest } from "../data-views-export";
import type {
  DataViewColumn,
  DataViewServer,
  FilterFieldConfig,
} from "../data-views-types";

/**
 * EXPORT EXPORTS THE QUERY, NOT THE PAGE.
 *
 * The bug this guards is the one every admin table ships with: the operator
 * filters 214 records, sees the 25 that were loaded, exports, and gets 25 —
 * silently. So the grid hands the host the live query UNPAGINATED and never
 * looks at `rows`. These tests assert exactly that, by loading a page of 2 out
 * of a declared total of 214 and reading what the host was handed.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  status: string;
  valor: number;
}

const rows: Row[] = [
  { id: "1", nome: "Ana", status: "pago", valor: 10 },
  { id: "2", nome: "Bruno", status: "recusado", valor: 25 },
];

const columns: DataViewColumn<Row>[] = [
  { id: "nome", header: "Nome", accessor: "nome", searchable: true },
  { id: "status", header: "Status", accessor: "status" },
  { id: "valor", header: "Valor", accessor: "valor" },
];

const fields: FilterFieldConfig<Row>[] = [
  {
    id: "status",
    label: "Status",
    accessor: (row) => row.status,
    options: [
      { value: "pago", label: "Pago" },
      { value: "recusado", label: "Recusado" },
    ],
  },
];

/** A server-mode grid loading page 1 of 25 out of 214 matched records. */
function serverOf(): DataViewServer {
  return { totalCount: 214, page: 1, pageSize: 25, onQueryChange: () => undefined };
}

function renderGrid(
  onExport: (request: DataViewExportRequest) => void,
  props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {},
) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={fields}
        getRowId={(row) => row.id}
        dataTestId="lista"
        testIdPrefix="lista"
        server={serverOf()}
        exportConfig={{ onExport }}
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Open the Exportar menu and pick a format. */
async function exportAs(format: "xlsx" | "csv" | "json"): Promise<void> {
  fireEvent.click(screen.getByTestId("lista-export-trigger"));
  fireEvent.click(await screen.findByTestId(`lista-export-${format}`));
}

/**
 * Dismiss the topmost popover. MUI renders an invisible backdrop per Popover,
 * and clicking it is the same gesture the operator makes — closing by Escape
 * would test MUI's key handling rather than this grid's.
 */
function closeTopPopover(): void {
  const backdrops = document.querySelectorAll(".MuiBackdrop-root");
  const top = backdrops[backdrops.length - 1];
  if (top) fireEvent.click(top);
}

/** The request the host was handed on the Nth export. */
function requestOf(onExport: ReturnType<typeof vi.fn>, call = 0): DataViewExportRequest {
  return onExport.mock.calls[call]?.[0] as DataViewExportRequest;
}

/** Report a desktop viewport, so `inlineFilters` renders its bar rather than a modal. */
function stubWideViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("min-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the Exportar control", () => {
  it("is absent until a host wires one — like renderCard", async () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          testIdPrefix="lista"
          server={serverOf()}
        />
      </ThemeProvider>,
    );
    // Presence evidence first: the toolbar IS mounted (its Exibir control is
    // there), so the missing Exportar is a deliberate absence and not a race.
    expect(screen.getByTestId("lista-display-trigger")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("lista-export-trigger")).toBeNull());
  });

  it("hands the host the whole filtered set, not the loaded page", async () => {
    const onExport = vi.fn();
    renderGrid(onExport);

    await exportAs("xlsx");

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const request = requestOf(onExport);
    expect(request.format).toBe("xlsx");
    // 214 — the SERVER's matched total — and not 2 (loaded) or 25 (page size).
    expect(request.query.pageSize).toBe(214);
    expect(request.query.page).toBe(1);
  });

  it("carries the live filters into the export query", async () => {
    const onExport = vi.fn();
    stubWideViewport();
    renderGrid(onExport, { inlineFilters: true });

    const search = screen.getByTestId("lista-search-all");
    fireEvent.change(search, { target: { value: "ana" } });
    // The box DEBOUNCES (350ms) rather than committing on blur, so the query
    // is not live until the timer fires — waiting on the rendered counter is
    // what tells us it has.
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("lista-search-all")).toHaveValue("ana"));
    await exportAs("csv");

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const request = requestOf(onExport);
    expect(request.format).toBe("csv");
    expect(request.query.search).toBe("ana");
  });

  it("states the count it is about to export before the click", async () => {
    renderGrid(vi.fn());
    fireEvent.click(screen.getByTestId("lista-export-trigger"));
    const scope = await screen.findByTestId("lista-export-scope");
    expect(scope.textContent).toContain("214 itens filtrados");
  });

  /**
   * Selection now OWNS the toolbar: ticking a row replaces the browsing
   * controls with the selection cluster, so Exportar is not on screen to be
   * opened. Export-of-a-selection is therefore a HOST concern now — it belongs
   * in the "Ações" bulk menu, not in this component's toolbar.
   *
   * The export request still carries `selectedIds` for a host that drives the
   * menu itself; what changed is that the built-in trigger is unreachable while
   * a selection is active.
   */
  it("yields the toolbar — Exportar included — the moment a row is selected", async () => {
    renderGrid(vi.fn());

    expect(screen.getByTestId("lista-export-trigger")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select all rows"));

    // The trigger is REMOVED by the click, so its absence has to be awaited.
    await waitFor(() => expect(screen.queryByTestId("lista-export-trigger")).toBeNull());
    expect(screen.getByTestId("lista-clear-all")).toBeInTheDocument();
  });

  it("sends the visible columns in the operator's current order", async () => {
    const onExport = vi.fn();
    renderGrid(onExport);

    // Hide "valor" through the Exibir panel, then export.
    fireEvent.click(screen.getByTestId("lista-display-trigger"));
    fireEvent.click(await screen.findByTestId("lista-display-tab-columns"));
    const toggle = (await screen.findByTestId("lista-column-toggle-valor")).querySelector("input");
    if (!toggle) throw new Error("column toggle input not found");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("lista-columns-count").textContent).toContain("2 de 3"),
    );
    closeTopPopover();

    await exportAs("xlsx");
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const request = requestOf(onExport);
    expect(request.columns.map((col) => col.id)).toEqual(["nome", "status"]);
  });

  it("offers only the formats the host declared", async () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <DataViewsGrid<Row>
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          testIdPrefix="lista"
          server={serverOf()}
          exportConfig={{ onExport: vi.fn(), formats: ["csv"] }}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("lista-export-trigger"));
    await screen.findByTestId("lista-export-csv");
    await waitFor(() => expect(screen.queryByTestId("lista-export-xlsx")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("lista-export-json")).toBeNull());
  });

  it("disables the trigger while the host's export is still running", async () => {
    // A container's property rather than a closed-over binding: the export is
    // deliberately left in flight, and the gate has to survive the re-render.
    const gate: { release?: () => void } = {};
    const onExport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
        }),
    );
    renderGrid(onExport);

    await exportAs("xlsx");
    await waitFor(() => expect(screen.getByTestId("lista-export-trigger")).toBeDisabled());

    gate.release?.();
    await waitFor(() => expect(screen.getByTestId("lista-export-trigger")).not.toBeDisabled());
  });
});
