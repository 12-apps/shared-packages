/**
 * THE LISTA'S COLUMNS BELONG TO THE LIST, NOT TO EACH ROW.
 *
 * Before `listGroup`, the Lista rendered every row inside its own wrapper `Box`
 * and each row resolved its own tracks from its own copy of the cell config.
 * Identical configs over identical data line up in practice — which is the kind
 * of agreement that holds right up until one row carries an unusually wide value
 * and pushes its rails out of step with its neighbours.
 *
 * The fix is structural, so the tests are structural. Two things must be true,
 * and the second is the one that actually bites:
 *
 *   1. the rows sit inside a `ListCardGroup` that owns one set of tracks;
 *   2. each row is a DIRECT CHILD of that group's grid. A row is subgrid over
 *      the group (`gridColumn: span railCount`), and subgrid only resolves
 *      against the immediate parent grid. One wrapper element between them and
 *      every rail silently collapses — the same misalignment, now with a group
 *      around it giving false assurance.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { BaseListCard } from "../base-list-card";
import { DataViewsGrid } from "../DataViewsGrid";
import type { ListGroupConfig } from "../list-card-rails";
import type { ListCardCellConfig } from "../list-card-cells";
import type { DataViewCardSelection, DataViewColumn } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  cliente: string;
  total: string;
}

const rows: Row[] = [
  { id: "1", cliente: "Thom", total: "R$ 8,90" },
  // A deliberately long value: the row that used to drag its own rails out of
  // step with the short one above it.
  { id: "2", cliente: "Ana Paula Rodrigues de Menezes", total: "R$ 1.312,50" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "cliente", header: "Cliente", accessor: "cliente", searchable: true },
];

const CELLS: readonly ListCardCellConfig<Row>[] = [
  { id: "cliente", primary: (row) => row.cliente },
  { id: "total", primary: (row) => row.total, align: "end", width: "max-content" },
];

const listGroup: ListGroupConfig<Row> = { cells: CELLS };

function renderListRow(row: Row, selection: DataViewCardSelection): React.ReactNode {
  return (
    <BaseListCard
      row={row}
      testId={`row-${row.id}`}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
    />
  );
}

/**
 * MUI's `sx` compiles to emotion CLASSES, not inline styles, so `.style` is
 * empty here and every assertion below has to go through the cascade. jsdom does
 * resolve emotion's injected rules, so this reports the real value.
 */
const styleOf = (el: Element): CSSStyleDeclaration => getComputedStyle(el);

function renderGrid(group?: ListGroupConfig<Row>): void {
  render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={[]}
        getRowId={(row) => row.id}
        renderListRow={renderListRow}
        listGroup={group}
        defaultLayout="list"
        ignoreStoredLayout
        dataTestId="pedidos"
        testIdPrefix="pedidos"
      />
    </ThemeProvider>,
  );
}

describe("Lista column group", () => {
  it("wraps the rows in one group that owns the tracks", () => {
    renderGrid(listGroup);

    const group = screen.getByTestId("pedidos-list");
    // One grid, one template — the single declaration every row answers. The
    // template is the configured shape: the four head rails, one track per cell,
    // then the actions rail. `max-content` on the money cell survives, which is
    // what keeps a column of amounts from moving when a longer one arrives.
    expect(styleOf(group).display).toBe("grid");
    expect(styleOf(group).gridTemplateColumns).toBe(
      "auto auto auto auto minmax(0, 1fr) max-content auto",
    );
  });

  it("makes every row a DIRECT child of the group", () => {
    renderGrid(listGroup);

    const group = screen.getByTestId("pedidos-list");
    for (const id of ["row-1", "row-2"]) {
      const row = screen.getByTestId(id);
      expect(row.parentElement).toBe(group);
    }
  });

  it("gives both rows the same subgrid span, long value or not", () => {
    renderGrid(listGroup);

    const first = screen.getByTestId("row-1");
    const second = screen.getByTestId("row-2");
    // Subgrid over the group's tracks: NEITHER row resolves its own, so the long
    // name in row 2 cannot push its rails out of step with row 1.
    expect(styleOf(first).gridTemplateColumns).toBe("subgrid");
    expect(styleOf(second).gridTemplateColumns).toBe("subgrid");
    expect(styleOf(second).gridColumn).toBe(styleOf(first).gridColumn);
  });

  it("still renders a plain list when no group is configured", () => {
    renderGrid(undefined);

    // The old shape stays available and unchanged: a flex column of wrappers,
    // each row resolving its own tracks. Omitting `listGroup` is not an error —
    // it is the pre-existing behaviour every current caller relies on.
    const list = screen.getByTestId("pedidos-list");
    expect(styleOf(list).display).toBe("flex");
    const row = screen.getByTestId("row-1");
    expect(row.parentElement).not.toBe(list);
    expect(styleOf(row).gridTemplateColumns).not.toBe("subgrid");
  });
});
