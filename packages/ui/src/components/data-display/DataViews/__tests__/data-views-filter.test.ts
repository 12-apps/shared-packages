import { describe, expect, it } from "vitest";

import { filterRows } from "../data-views-filter";
import type {
  DataViewColumn,
  FilterFieldConfig,
  RangeFieldConfig,
} from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
  tags: string[];
  price: number;
  stock: number | null;
}

const rows: Row[] = [
  { id: "1", name: "Ana", status: "ACTIVE", tags: ["vip"], price: 10, stock: 5 },
  { id: "2", name: "Bruno", status: "INACTIVE", tags: ["new"], price: 20, stock: 0 },
  { id: "3", name: "Carla", status: "ACTIVE", tags: ["vip", "new"], price: 30, stock: null },
];

const rangeFields: RangeFieldConfig<Row>[] = [
  { id: "price", label: "Preço", accessor: (row) => row.price },
  { id: "stock", label: "Estoque", accessor: (row) => row.stock },
];

const columns: DataViewColumn<Row>[] = [
  { id: "name", header: "Nome", accessor: "name", searchable: true },
  { id: "status", header: "Status", accessor: "status" },
];

const fields: FilterFieldConfig<Row>[] = [
  { id: "status", label: "Status", options: [
    { value: "ACTIVE", label: "Ativo" },
    { value: "INACTIVE", label: "Inativo" },
  ] },
  { id: "tags", label: "Tags", accessor: (row) => row.tags, options: [
    { value: "vip", label: "VIP" },
    { value: "new", label: "Novo" },
  ] },
];

const ids = (result: Row[]): string[] => result.map((r) => r.id);

describe("filterRows", () => {
  it("returns every row with no search or pills", () => {
    expect(ids(filterRows(rows, columns, fields, { search: "", pills: {} }))).toEqual(["1", "2", "3"]);
  });

  it("matches the search term across searchable columns only", () => {
    expect(ids(filterRows(rows, columns, fields, { search: "car", pills: {} }))).toEqual(["3"]);
    // status is not searchable, so a status term matches nothing by search.
    expect(filterRows(rows, columns, fields, { search: "active", pills: {} })).toHaveLength(0);
  });

  it("narrows by a single-value pill", () => {
    expect(ids(filterRows(rows, columns, fields, { search: "", pills: { status: ["ACTIVE"] } }))).toEqual(["1", "3"]);
  });

  it("treats a multi-value field via its accessor as OR membership", () => {
    expect(ids(filterRows(rows, columns, fields, { search: "", pills: { tags: ["new"] } }))).toEqual(["2", "3"]);
  });

  it("combines search AND pills", () => {
    const result = filterRows(rows, columns, fields, { search: "a", pills: { status: ["ACTIVE"] } });
    // "a" matches Ana + Carla; ACTIVE keeps both.
    expect(ids(result)).toEqual(["1", "3"]);
  });

  it("ignores a pill with an empty selection", () => {
    expect(ids(filterRows(rows, columns, fields, { search: "", pills: { status: [] } }))).toEqual(["1", "2", "3"]);
  });

  describe("numeric ranges", () => {
    const crit = (ranges: Record<string, { min?: number; max?: number }>) => ({
      search: "",
      pills: {},
      ranges,
    });

    it("filters by a minimum bound", () => {
      expect(ids(filterRows(rows, columns, fields, crit({ price: { min: 20 } }), rangeFields))).toEqual(["2", "3"]);
    });

    it("filters by a maximum bound", () => {
      expect(ids(filterRows(rows, columns, fields, crit({ price: { max: 20 } }), rangeFields))).toEqual(["1", "2"]);
    });

    it("filters by an inclusive min+max window", () => {
      expect(ids(filterRows(rows, columns, fields, crit({ price: { min: 10, max: 20 } }), rangeFields))).toEqual(["1", "2"]);
    });

    it("excludes rows whose value is null when a bound is set", () => {
      // Carla (id 3) has null stock, so any bounded stock range drops her.
      expect(ids(filterRows(rows, columns, fields, crit({ stock: { min: 0 } }), rangeFields))).toEqual(["1", "2"]);
    });

    it("ignores an empty range (no bounds)", () => {
      expect(ids(filterRows(rows, columns, fields, crit({ price: {} }), rangeFields))).toEqual(["1", "2", "3"]);
    });

    it("ignores an inverted range (max < min) instead of filtering everything out", () => {
      expect(ids(filterRows(rows, columns, fields, crit({ price: { min: 30, max: 10 } }), rangeFields))).toEqual(["1", "2", "3"]);
    });

    it("combines ranges with pills", () => {
      const result = filterRows(rows, columns, fields, { search: "", pills: { status: ["ACTIVE"] }, ranges: { price: { min: 25 } } }, rangeFields);
      // ACTIVE → Ana(10), Carla(30); price ≥ 25 → only Carla.
      expect(ids(result)).toEqual(["3"]);
    });
  });
});
