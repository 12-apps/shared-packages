import { describe, expect, it } from "vitest";

import { describeViewState } from "../data-views-preview";
import type { DataViewColumn, DataViewState, FilterFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
}

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome" },
  { id: "status", header: "Status" },
  { id: "actions", header: "", hideable: false },
];

const fields: FilterFieldConfig<Row>[] = [
  { id: "status", label: "Status", options: [{ value: "ACTIVE", label: "Ativo" }] },
];

describe("describeViewState", () => {
  it("summarizes search, pills, HIDDEN columns, and sort with labels", () => {
    const state: DataViewState = {
      search: "burg",
      pills: { status: ["ACTIVE"] },
      sortBy: [{ id: "name", dir: "asc" }],
      // Everything hideable is visible, so this view hides nothing.
      visibleColumns: ["name", "status"],
    };

    const result = describeViewState(state, fields, columns);

    expect(result.filters).toEqual(['Busca: "burg"', "Status: Ativo"]);
    expect(result.columns).toEqual([]);
    expect(result.sort).toEqual(["Nome (crescente)"]);
  });

  it("returns empty sections when a view changes nothing", () => {
    // Every hideable column visible: no filters, no hiding, no sort.
    const state: DataViewState = {
      search: "",
      pills: {},
      sortBy: [],
      visibleColumns: ["name", "status"],
    };
    expect(describeViewState(state, fields, columns)).toEqual({ filters: [], columns: [], sort: [] });
  });

  it("names the columns a view HIDES, since that is what it changed", () => {
    const state: DataViewState = { search: "", pills: {}, sortBy: [], visibleColumns: ["name"] };
    expect(describeViewState(state, fields, columns).columns).toEqual(["Status"]);
  });

  it("omits the actions column (non-hideable) — it cannot be hidden, so it is never news", () => {
    const state: DataViewState = {
      search: "",
      pills: {},
      sortBy: [],
      visibleColumns: ["name", "actions"],
    };
    // "status" is hidden and reported; "actions" is absent but not hideable.
    expect(describeViewState(state, fields, columns).columns).toEqual(["Status"]);
  });
});
