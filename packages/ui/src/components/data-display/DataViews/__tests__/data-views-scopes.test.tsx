import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { assertNoScopePillOverlap, resolveScope, type ScopeConfig } from "../data-views-scopes";
import type {
  DataViewColumn,
  DataViewQuery,
  DataViewServer,
  FilterFieldConfig,
} from "../data-views-types";

/**
 * SCOPES — the page-level partition, its server-supplied counts, and the rules
 * that keep a table which declares none byte-identical to before.
 *
 * Every assertion here is written against the emitted `DataViewQuery` or against
 * the rendered strip, never against resulting row contents: these are server-mode
 * tables, and a scope that could be satisfied by filtering an in-memory array
 * has been implemented wrong.
 */

interface Row extends Record<string, unknown> {
  id: string;
  cliente: string;
  estado: string;
  metodo: string;
}

const rows: Row[] = [
  { id: "1", cliente: "Ana", estado: "pago", metodo: "pix" },
  { id: "2", cliente: "Bruno", estado: "recusado", metodo: "credito" },
  { id: "3", cliente: "Carla", estado: "autorizado", metodo: "pix" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "cliente", header: "Cliente", accessor: "cliente", searchable: true },
  { id: "estado", header: "Estado", accessor: "estado" },
];

const SCOPES: ScopeConfig[] = [
  { id: "todos", label: "Todos" },
  { id: "pagos", label: "Pagos" },
  { id: "amenor", label: "A menor" },
  { id: "amaior", label: "A maior" },
  { id: "recusados", label: "Recusados" },
  { id: "autorizados", label: "Autorizados" },
];

const methodField: FilterFieldConfig<Row>[] = [
  {
    id: "metodo",
    label: "Método",
    options: [
      { value: "pix", label: "PIX" },
      { value: "credito", label: "Crédito" },
    ],
  },
];

interface Harness {
  queries: DataViewQuery[];
  server: DataViewServer;
}

/** A server-mode wiring that records every emitted query. */
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

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="pagamentos"
        testIdPrefix="pagamentos"
        {...props}
      />
    </ThemeProvider>,
  );
}

const tab = (id: string): HTMLElement => screen.getByTestId(`pagamentos-scope-${id}`);

/** The same grid with a fresh `syncState` reference — what a deep link looks like. */
function gridWithSync(server: DataViewServer, scope: string): React.JSX.Element {
  return (
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="pagamentos"
        testIdPrefix="pagamentos"
        scopes={SCOPES}
        server={server}
        syncState={{ search: "", pills: {}, ranges: {}, sortBy: [], scope }}
      />
    </ThemeProvider>
  );
}

/** The filter panel keeps its fields mounted (hidden), so query the input directly. */
function pillOption(value: string): HTMLInputElement {
  const input = screen.getByTestId(`pagamentos-filter-metodo-${value}`).querySelector("input");
  if (!input) throw new Error(`checkbox input for ${value} not found`);
  return input;
}

const last = (queries: DataViewQuery[]): DataViewQuery => {
  const query = queries.at(-1);
  if (!query) throw new Error("no query was emitted");
  return query;
};

beforeEach(() => window.localStorage.clear());

describe("resolveScope", () => {
  it("returns undefined when nothing is declared, so no scope key reaches the query", () => {
    expect(resolveScope([], undefined)).toBeUndefined();
    expect(resolveScope([], "recusados")).toBeUndefined();
  });

  it("falls back to the FIRST declared scope for an unknown or absent stored id", () => {
    expect(resolveScope(SCOPES, undefined)).toBe("todos");
    // A scope removed after a view was saved: resolve on read, never break the view.
    expect(resolveScope(SCOPES, "arquivados")).toBe("todos");
  });

  it("keeps a stored id that is still declared", () => {
    expect(resolveScope(SCOPES, "recusados")).toBe("recusados");
  });
});

describe("assertNoScopePillOverlap", () => {
  it("throws in development, naming the field and both declarations", () => {
    expect(() => assertNoScopePillOverlap(SCOPES, ["metodo", "estado"], "estado")).toThrow(/estado/);
    expect(() => assertNoScopePillOverlap(SCOPES, ["metodo", "estado"], "estado")).toThrow(/recusados/);
  });

  it("does not throw in production — a duplicated control beats a blank page", () => {
    // `vi.stubEnv` restores in `afterEach` via `unstubEnvs`, so no other test
    // inherits a production NODE_ENV.
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertNoScopePillOverlap(SCOPES, ["estado"], "estado")).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("accepts a table whose scope field is not also a pill", () => {
    expect(() => assertNoScopePillOverlap(SCOPES, ["metodo"], "estado")).not.toThrow();
    expect(() => assertNoScopePillOverlap([], ["estado"], "estado")).not.toThrow();
  });
});

describe("DataViews scopes", () => {
  it("makes the first declared scope active on load and emits no extra query", () => {
    const { queries, server } = harness();
    renderGrid({ scopes: SCOPES, server });
    expect(tab("todos")).toHaveAttribute("aria-selected", "true");
    expect(tab("recusados")).toHaveAttribute("aria-selected", "false");
    // Declaring scopes must not, by itself, make the table fetch again.
    expect(queries).toHaveLength(0);
  });

  it("emits exactly one query carrying the scope and page 1 when a scope is selected", async () => {
    const { queries, server } = harness({ page: 4 });
    renderGrid({ scopes: SCOPES, server });

    fireEvent.click(tab("recusados"));

    await waitFor(() => expect(queries).toHaveLength(1));
    expect(last(queries).scope).toBe("recusados");
    expect(last(queries).page).toBe(1);
  });

  it("is mutually exclusive — selecting one deselects the other", async () => {
    const { queries, server } = harness();
    renderGrid({ scopes: SCOPES, server });

    fireEvent.click(tab("recusados"));
    await waitFor(() => expect(tab("recusados")).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(tab("pagos"));

    await waitFor(() => expect(tab("pagos")).toHaveAttribute("aria-selected", "true"));
    expect(tab("recusados")).toHaveAttribute("aria-selected", "false");
    expect(last(queries).scope).toBe("pagos");
  });

  it("composes with the pills instead of competing with them", async () => {
    const { queries, server } = harness();
    renderGrid({ scopes: SCOPES, fields: methodField, server });

    fireEvent.click(tab("recusados"));
    await waitFor(() => expect(queries).toHaveLength(1));
    fireEvent.click(pillOption("pix"));

    await waitFor(() => expect(last(queries).pills.metodo).toEqual(["pix"]));
    expect(last(queries).scope).toBe("recusados");
  });

  it("renders the server's scopeCounts verbatim, never a count of the loaded page", () => {
    // 3 rows are loaded; the counts say 180 and 2. The tabs must say 180 and 2.
    const { server } = harness({
      scopeCounts: { todos: 214, pagos: 180, amenor: 3, amaior: 0, recusados: 2, autorizados: 8 },
    });
    renderGrid({ scopes: SCOPES, server });

    expect(screen.getByTestId("pagamentos-scope-count-pagos")).toHaveTextContent("180");
    expect(screen.getByTestId("pagamentos-scope-count-recusados")).toHaveTextContent("2");
    expect(screen.queryByTestId("pagamentos-scope-count-pagos")).not.toHaveTextContent("3");
  });

  it("keeps an empty scope reachable and shows its zero", () => {
    const { server } = harness({ scopeCounts: { amaior: 0 } });
    renderGrid({ scopes: SCOPES, server });

    expect(screen.getByTestId("pagamentos-scope-count-amaior")).toHaveTextContent("0");
    expect(tab("amaior")).not.toBeDisabled();
  });

  it("degrades quietly when the server omits scopeCounts — no invented numbers", async () => {
    const { server } = harness();
    renderGrid({ scopes: SCOPES, server });

    expect(screen.getByTestId("pagamentos-scopes")).toBeInTheDocument();
    // The tab is there; only its badge is absent — no number was invented.
    await waitFor(() =>
      expect(screen.queryByTestId("pagamentos-scope-count-pagos")).not.toBeInTheDocument(),
    );
    expect(tab("pagos")).toHaveAccessibleName("Pagos");
  });

  it("puts the count in each tab's accessible name", () => {
    const { server } = harness({ scopeCounts: { recusados: 2 } });
    renderGrid({ scopes: SCOPES, server });
    expect(tab("recusados")).toHaveAccessibleName("Recusados, 2");
  });

  it("exposes the strip as a tab list with exactly one selected tab", () => {
    const { server } = harness();
    renderGrid({ scopes: SCOPES, server });

    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(tabs).toHaveLength(SCOPES.length);
    expect(tabs.filter((element) => element.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("moves between tabs with the arrow keys, wrapping at the last one", async () => {
    const { queries, server } = harness();
    renderGrid({ scopes: SCOPES, server });

    fireEvent.keyDown(tab("todos"), { key: "ArrowRight" });
    await waitFor(() => expect(tab("pagos")).toHaveAttribute("aria-selected", "true"));
    expect(queries).toHaveLength(1);

    // From the LAST tab, right wraps to the first.
    fireEvent.click(tab("autorizados"));
    await waitFor(() => expect(tab("autorizados")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(tab("autorizados"), { key: "ArrowRight" });
    await waitFor(() => expect(tab("todos")).toHaveAttribute("aria-selected", "true"));
  });

  it("moves the strip when a deep link carries a declared scope", async () => {
    const { queries, server } = harness();
    const { rerender } = renderGrid({ scopes: SCOPES, server });

    // A syncState REFERENCE change is how a deep link / back-forward arrives.
    rerender(gridWithSync(server, "recusados"));

    await waitFor(() => expect(tab("recusados")).toHaveAttribute("aria-selected", "true"));
    expect(queries).toHaveLength(1);
    expect(last(queries).scope).toBe("recusados");
  });

  it("falls back to the first scope for an unknown deep link, and emits the RESOLVED id", async () => {
    const { queries, server } = harness();
    const { rerender } = renderGrid({ scopes: SCOPES, server });

    fireEvent.click(tab("recusados"));
    await waitFor(() => expect(queries).toHaveLength(1));

    // A scope removed since the link was written, or a renamed facet.
    rerender(gridWithSync(server, "arquivados"));

    await waitFor(() => expect(tab("todos")).toHaveAttribute("aria-selected", "true"));
    expect(queries).toHaveLength(2);
    // The RESOLVED id travels, never the stored one the backend would reject.
    expect(last(queries).scope).toBe("todos");
  });

  it("clears the selection when the scope changes", async () => {
    const { server } = harness();
    renderGrid({ scopes: SCOPES, server, rowActions: [{ id: "x", label: "X", onSelect: vi.fn() }] });

    fireEvent.click(screen.getByLabelText("Select all rows"));
    await waitFor(() => expect(screen.getByTestId("pagamentos-clear-all")).toBeInTheDocument());

    fireEvent.click(tab("recusados"));

    await waitFor(() => expect(screen.queryByTestId("pagamentos-clear-all")).not.toBeInTheDocument());
  });
});

describe("a table declaring no scopes", () => {
  it("renders no tab list and reserves no space", async () => {
    const { server } = harness();
    renderGrid({ server });
    // The grid itself rendered; the strip simply is not part of it.
    expect(screen.getByTestId("pagamentos-container")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("pagamentos-scopes")).not.toBeInTheDocument());
  });

  it("emits a query with NO scope key at all", async () => {
    const { queries, server } = harness();
    renderGrid({ fields: methodField, server });

    fireEvent.click(pillOption("pix"));

    await waitFor(() => expect(queries).toHaveLength(1));
    // Present-and-undefined is not good enough: every host would have to know
    // to ignore it. The key must be absent.
    expect(last(queries)).not.toHaveProperty("scope");
  });
});
