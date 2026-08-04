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
  it("summarizes search, pills, visible columns, and sort with labels", () => {
    const state: DataViewState = {
      search: "burg",
      pills: { status: ["ACTIVE"] },
      sortBy: [{ id: "name", dir: "asc" }],
      visibleColumns: ["name", "status"],
    };

    const result = describeViewState(state, fields, columns);

    expect(result.filters).toEqual(['Busca: "burg"', "Status: Ativo"]);
    expect(result.columns).toEqual(["Nome", "Status"]);
    expect(result.sort).toEqual(["Nome (crescente)"]);
  });

  it("returns empty sections for a pristine state", () => {
    const state: DataViewState = { search: "", pills: {}, sortBy: [], visibleColumns: [] };
    const result = describeViewState(state, fields, columns);
    expect(result).toEqual({ filters: [], columns: [], sort: [] });
  });

  it("omits the actions column (non-hideable) from the columns summary", () => {
    const state: DataViewState = {
      search: "",
      pills: {},
      sortBy: [],
      visibleColumns: ["name", "actions"],
    };
    expect(describeViewState(state, fields, columns).columns).toEqual(["Nome"]);
  });
});
