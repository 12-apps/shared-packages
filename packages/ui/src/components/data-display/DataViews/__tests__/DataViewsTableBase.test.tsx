import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsTableBase } from "../DataViewsTableBase";
import type {
  DataViewColumn,
  DataViewPersistence,
  DataViewRouter,
  DataViewServer,
  DataViewState,
  FilterFieldConfig,
} from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Ana", status: "ACTIVE" },
  { id: "2", name: "Bruno", status: "INACTIVE" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
  { id: "status", header: "Status", accessor: "status", searchable: true },
  { id: "actions", header: "", type: "actions", hideable: false, cell: () => null },
];

const fields: FilterFieldConfig<Row>[] = [];

const persistence: DataViewPersistence = {
  create: vi.fn(async () => ({ ok: true as const })),
  update: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const })),
};
const router: DataViewRouter = { syncViewParam: vi.fn(), refresh: vi.fn() };

/** A server-mode wiring; `onQueryChange` is a no-op — we only assert the controls. */
const server: DataViewServer = { totalCount: 2, page: 1, pageSize: 20, onQueryChange: vi.fn() };

/** The URL-seeded controls a server page would parse off the address bar. */
function urlState(search: string): DataViewState {
  return { search, pills: {}, ranges: {}, sortBy: [], visibleColumns: [] };
}

function renderBase(props: Partial<React.ComponentProps<typeof DataViewsTableBase<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsTableBase<Row>
        persistence={persistence}
        router={router}
        rows={rows}
        columns={columns}
        fields={fields}
        getRowId={(row) => row.id}
        views={[]}
        dataTestId="people"
        testIdPrefix="people"
        {...props}
      />
    </ThemeProvider>,
  );
}

const searchInput = (): HTMLInputElement =>
  screen.getByTestId("people-search-all") as HTMLInputElement;

describe("DataViewsTableBase — URL sync (FUT-180)", () => {
  it("seeds the search box from initialState", () => {
    renderBase({ server, initialState: urlState("maria") });
    expect(searchInput().value).toBe("maria");
  });

  it("re-applies the URL controls on a later initialState change (server mode: back/forward)", async () => {
    // A new initialState reference is exactly what a browser back/forward produces:
    // the server component re-renders with the restored URL's controls. In server
    // mode the base forwards them as the grid's reactive `syncState`, so the
    // controls reconcile instead of staying stuck on the previous query.
    const { rerender } = renderBase({ server, initialState: urlState("maria") });
    expect(searchInput().value).toBe("maria");

    rerender(
      <ThemeProvider theme={createTheme()}>
        <DataViewsTableBase<Row>
          persistence={persistence}
          router={router}
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          views={[]}
          dataTestId="people"
          testIdPrefix="people"
          server={server}
          initialState={urlState("ana")}
        />
      </ThemeProvider>,
    );

    await waitFor(() => expect(searchInput().value).toBe("ana"));
  });

  it("does NOT reactively re-apply in client mode (no server): initialState only seeds on mount", () => {
    // Client-mode lists don't keep their filters in the URL, so a changing
    // initialState must not force the controls — only the mount seed applies.
    // Without a `server` wiring the base forwards no `syncState`, so re-rendering
    // with a new initialState leaves the seeded search untouched (a synchronous
    // fact: no reconciling effect exists to fire).
    const { rerender } = renderBase({ initialState: urlState("maria") });
    expect(searchInput().value).toBe("maria");

    rerender(
      <ThemeProvider theme={createTheme()}>
        <DataViewsTableBase<Row>
          persistence={persistence}
          router={router}
          rows={rows}
          columns={columns}
          fields={fields}
          getRowId={(row) => row.id}
          views={[]}
          dataTestId="people"
          testIdPrefix="people"
          initialState={urlState("ana")}
        />
      </ThemeProvider>,
    );

    expect(searchInput().value).toBe("maria");
  });
});
