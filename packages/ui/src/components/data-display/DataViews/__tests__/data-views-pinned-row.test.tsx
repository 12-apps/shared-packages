/**
 * DataViews' pinned row (FUT-4745): `pinnedRowId` puts one row first and
 * tints it, in the table and in the cards, whatever the sort or the filter —
 * and shows it ONCE, never also in its sorted place.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { pinnedRowTint } from "../../DataGrid/DataGrid.pinned";
import { DataViewsGrid } from "../DataViewsGrid";
import { emptyViewState, type DataViewColumn, type DataViewState } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = [
  { id: "1", name: "Bruno", status: "ACTIVE" },
  { id: "2", name: "Ana", status: "INACTIVE" },
  { id: "3", name: "Carla", status: "ACTIVE" },
  { id: "4", name: "Davi", status: "ACTIVE" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
  { id: "status", header: "Status", accessor: "status" },
];

function stateWith(patch: Partial<DataViewState>): DataViewState {
  return { ...emptyViewState(["name", "status"]), ...patch };
}

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="items"
        testIdPrefix="items"
        selectable={false}
        ignoreStoredLayout
        {...props}
      />
    </ThemeProvider>,
  );
}

/** The names in the table body, in render order. */
const tableNames = (): string[] =>
  Array.from(screen.getByTestId("items").querySelectorAll('[data-slot="row"]')).map(
    (row) => row.querySelector('[data-col-id="name"]')?.textContent ?? "",
  );

/** The names on the cards, in render order. */
const cardNames = (): string[] =>
  Array.from(screen.getByTestId("items-cards").querySelectorAll("[data-card-name]")).map(
    (card) => card.textContent ?? "",
  );

const renderCard = (row: Row): React.ReactNode => <div data-card-name>{row.name}</div>;

beforeEach(() => window.localStorage.clear());

describe("DataViews pinnedRowId — table layout", () => {
  it("without the prop keeps the existing order and pins nothing", () => {
    renderGrid({ appliedState: stateWith({ sortBy: [{ id: "name", dir: "asc" }] }) });
    expect(tableNames()).toEqual(["Ana", "Bruno", "Carla", "Davi"]);
    expect(screen.getByTestId("items").querySelector("[data-pinned]")).toBeNull();
  });

  it.each<["asc" | "desc", string[]]>([
    ["asc", ["Carla", "Ana", "Bruno", "Davi"]],
    ["desc", ["Carla", "Davi", "Bruno", "Ana"]],
  ])("shows the pinned row first under a %s sort, and only once", (dir, expected) => {
    renderGrid({ pinnedRowId: "3", appliedState: stateWith({ sortBy: [{ id: "name", dir }] }) });
    expect(tableNames()).toEqual(expected);
  });

  it("keeps it first with no sort at all", () => {
    renderGrid({ pinnedRowId: "4" });
    expect(tableNames()).toEqual(["Davi", "Bruno", "Ana", "Carla"]);
  });

  it("keeps it first under a filter that matches it, and the filter still narrows the rest", () => {
    renderGrid({ pinnedRowId: "3", appliedState: stateWith({ search: "a", sortBy: [{ id: "name", dir: "desc" }] }) });
    // "a" matches Carla, Davi and Ana — not Bruno.
    expect(tableNames()).toEqual(["Carla", "Davi", "Ana"]);
  });

  it("keeps it first even when the filter would hide it", () => {
    renderGrid({ pinnedRowId: "1", appliedState: stateWith({ search: "carla" }) });
    expect(tableNames()).toEqual(["Bruno", "Carla"]);
  });

  it("pins nothing, without throwing, when the id is not in the data", () => {
    renderGrid({ pinnedRowId: "nope", pinnedRowLabel: "Saved now" });
    expect(tableNames()).toEqual(["Bruno", "Ana", "Carla", "Davi"]);
    expect(screen.getByTestId("items").querySelector("[data-pinned]")).toBeNull();
    expect(screen.queryByText("Saved now")).toBeNull();
  });

  it("treats null as no pin", () => {
    renderGrid({ pinnedRowId: null });
    expect(tableNames()).toEqual(["Bruno", "Ana", "Carla", "Davi"]);
  });

  it("tints the pinned row and exposes the host's label inside it", () => {
    renderGrid({ pinnedRowId: "3", pinnedRowLabel: "Saved now" });
    const pinned = screen.getByTestId("items").querySelector('[data-pinned="true"]') as HTMLElement;
    expect(pinned).not.toBeNull();
    // The theme's success tint, normalised by jsdom the same way on both sides.
    const probe = document.createElement("div");
    probe.style.backgroundColor = pinnedRowTint(createTheme());
    expect(getComputedStyle(pinned).backgroundColor).toBe(probe.style.backgroundColor);
    expect(within(pinned).getByText("Saved now")).toBeInTheDocument();
    expect(screen.getAllByText("Saved now")).toHaveLength(1);
  });
});

describe("DataViews pinnedRowId — cards layout", () => {
  const cards = { renderCard, defaultLayout: "cards" as const };

  it("without the prop keeps the existing order", () => {
    renderGrid(cards);
    expect(cardNames()).toEqual(["Bruno", "Ana", "Carla", "Davi"]);
    expect(screen.getByTestId("items-cards").querySelector("[data-pinned]")).toBeNull();
  });

  it("shows the pinned card first, once, under a filter", () => {
    renderGrid({ ...cards, pinnedRowId: "4", appliedState: stateWith({ search: "a" }) });
    expect(cardNames()).toEqual(["Davi", "Ana", "Carla"]);
  });

  it("marks and labels only the pinned card", () => {
    renderGrid({ ...cards, pinnedRowId: "2", pinnedRowLabel: "Saved now" });
    const pinned = screen.getByTestId("items-cards").querySelectorAll('[data-pinned="true"]');
    expect(pinned).toHaveLength(1);
    expect(within(pinned[0] as HTMLElement).getByText("Saved now")).toBeInTheDocument();
    expect(within(pinned[0] as HTMLElement).getByText("Ana")).toBeInTheDocument();
  });
});
