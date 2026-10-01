/**
 * A server-mode grid must not re-apply its OWN query when the host's URL echoes
 * it back late (FUT-3182).
 *
 * The host mirrors each emitted query into the URL and hands it back as
 * `initialState`. The browser shows the new URL before React renders it, so an
 * edit made in between (typing a bound, then clearing it) is followed by a
 * render carrying the PREVIOUS query. Merged as if it were a navigation, that
 * stale echo restored the cleared filter and the grid re-emitted it: the audit
 * trail's "De" date stayed in the URL after the field was emptied.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsTableBase } from "../DataViewsTableBase";
import { urlSliceKey, useUrlEchoGuard } from "../data-views-url-echo";
import type {
  DataViewColumn,
  DataViewPersistence,
  DataViewQuery,
  DataViewRouter,
  DataViewServer,
  DataViewState,
} from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "1", name: "Ana" }];
const columns: DataViewColumn<Row>[] = [{ id: "name", header: "Nome", accessor: "name", searchable: true }];
const persistence: DataViewPersistence = {
  create: vi.fn(async () => ({ ok: true as const })),
  update: vi.fn(async () => ({ ok: true as const })),
  remove: vi.fn(async () => ({ ok: true as const })),
};
const router: DataViewRouter = { syncViewParam: vi.fn(), refresh: vi.fn() };

function urlState(search: string): DataViewState {
  return { search, pills: {}, ranges: {}, sortBy: [], visibleColumns: [] };
}

function Grid({ server, initialState }: { server: DataViewServer; initialState: DataViewState }): React.JSX.Element {
  return (
    <ThemeProvider theme={createTheme()}>
      <DataViewsTableBase<Row>
        persistence={persistence}
        router={router}
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        views={[]}
        dataTestId="people"
        testIdPrefix="people"
        server={server}
        initialState={initialState}
      />
    </ThemeProvider>
  );
}

const searchInput = (): HTMLInputElement => screen.getByTestId("people-search-all") as HTMLInputElement;

function commitSearch(term: string): void {
  fireEvent.change(searchInput(), { target: { value: term } });
  fireEvent.keyDown(searchInput(), { key: "Enter" });
}

describe("DataViewsTableBase — the host echoing the grid's own query (FUT-3182)", () => {
  it("keeps an edit made before the previous query's URL render lands", async () => {
    const emitted: DataViewQuery[] = [];
    const server: DataViewServer = {
      totalCount: 1,
      page: 1,
      pageSize: 20,
      onQueryChange: (query) => emitted.push(query),
    };
    const { rerender } = render(<Grid server={server} initialState={urlState("")} />);

    commitSearch("maria");
    await waitFor(() => expect(emitted.at(-1)?.search).toBe("maria"));
    // Cleared before the host has rendered the URL that carries "maria".
    commitSearch("");
    await waitFor(() => expect(emitted.at(-1)?.search).toBe(""));

    // The host's render for the FIRST query lands now, then the one for the second.
    rerender(<Grid server={server} initialState={urlState("maria")} />);
    rerender(<Grid server={server} initialState={urlState("")} />);

    await waitFor(() => expect(searchInput().value).toBe(""));
    expect(emitted.map((query) => query.search)).toEqual(["maria", ""]);
  });

  it("still re-applies a URL the grid never emitted (back/forward)", async () => {
    const emitted: DataViewQuery[] = [];
    const server: DataViewServer = {
      totalCount: 1,
      page: 1,
      pageSize: 20,
      onQueryChange: (query) => emitted.push(query),
    };
    const { rerender } = render(<Grid server={server} initialState={urlState("")} />);

    commitSearch("maria");
    await waitFor(() => expect(emitted.at(-1)?.search).toBe("maria"));
    rerender(<Grid server={server} initialState={urlState("maria")} />);

    // Back: the URL returns to a state that is not pending.
    rerender(<Grid server={server} initialState={urlState("ana")} />);

    await waitFor(() => expect(searchInput().value).toBe("ana"));
  });
});

describe("urlSliceKey", () => {
  it("ignores what a host drops on the way through the URL", () => {
    const emitted = {
      search: "",
      pills: { status: [], actor: ["u1"] },
      ranges: { at: { min: "2026-09-01", max: "" }, total: {} },
      sortBy: [],
    };
    const echoed = { search: "", pills: { actor: ["u1"] }, ranges: { at: { min: "2026-09-01" } }, sortBy: [] };

    expect(urlSliceKey(emitted)).toBe(urlSliceKey(echoed));
  });

  it("tells a cleared bound from a set one", () => {
    const set = { search: "", pills: {}, ranges: { at: { min: "2026-09-01" } }, sortBy: [] };
    const cleared = { search: "", pills: {}, ranges: { at: { min: "" } }, sortBy: [] };

    expect(urlSliceKey(set)).not.toBe(urlSliceKey(cleared));
  });
});

describe("useUrlEchoGuard", () => {
  function Probe({ onReady }: { onReady: (guard: ReturnType<typeof useUrlEchoGuard>) => void }): null {
    onReady(useUrlEchoGuard({ totalCount: 0, page: 1, pageSize: 20, onQueryChange: vi.fn() }));
    return null;
  }

  function guard(): ReturnType<typeof useUrlEchoGuard> {
    let captured: ReturnType<typeof useUrlEchoGuard> | undefined;
    render(<Probe onReady={(g) => (captured = g)} />);
    if (!captured) throw new Error("guard not captured");
    return captured;
  }

  const query = (search: string): DataViewQuery => ({ ...urlState(search), ranges: {}, page: 1, pageSize: 20 });

  it("consumes a pending query once, with every older one", () => {
    const g = guard();
    g.server?.onQueryChange(query("a"));
    g.server?.onQueryChange(query("b"));

    expect(g.consumeEcho(urlState("b"))).toBe(true);
    expect(g.consumeEcho(urlState("a"))).toBe(false);
  });

  it("treats a miss as a navigation and forgets what was pending", () => {
    const g = guard();
    g.server?.onQueryChange(query("a"));

    expect(g.consumeEcho(urlState("z"))).toBe(false);
    expect(g.consumeEcho(urlState("a"))).toBe(false);
  });
});
