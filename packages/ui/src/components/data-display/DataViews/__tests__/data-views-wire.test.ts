import { describe, expect, it } from "vitest";

import { coerceViewState, toSavedViewSummary, type DataViewState } from "../data-views-types";
import {
  fromDataViewStateWire,
  readStoredViewState,
  toDataViewStateWire,
  type DataViewStateWire,
} from "../data-views-wire";
import { dataViewStateWireSchema } from "../wire";

/**
 * A saved view's stored shape (FUT-4867): the in-memory maps as keyed lists,
 * converters both ways, a schema with no open place, and reading that takes
 * the legacy maps every view stored so far is written in.
 */

const full: DataViewState = {
  search: "pizza",
  pills: { pagamento: ["Pix", "Cartão"], status: [] },
  ranges: { valor: { min: 10, max: 99.5 }, dia: { min: "2026-11-01" }, vazio: {} },
  sortBy: [{ id: "valor", dir: "desc" }],
  visibleColumns: ["pedido", "valor"],
  order: ["valor", "pedido"],
  scope: "abertos",
  layout: "cards",
};

const minimal: DataViewState = { search: "", pills: {}, sortBy: [], visibleColumns: [] };

const wireOfFull: DataViewStateWire = {
  search: "pizza",
  pills: [
    { field: "pagamento", values: ["Pix", "Cartão"] },
    { field: "status", values: [] },
  ],
  ranges: [
    { field: "valor", min: 10, max: 99.5 },
    { field: "dia", min: "2026-11-01" },
    { field: "vazio" },
  ],
  sortBy: [{ id: "valor", dir: "desc" }],
  visibleColumns: ["pedido", "valor"],
  order: ["valor", "pedido"],
  scope: "abertos",
  layout: "cards",
};

/** Zod's own description of a schema, as far as the walk below reads it. */
interface Def {
  type: string;
  [key: string]: unknown;
}

const defOf = (schema: unknown): Def | null =>
  (schema as { _zod?: { def?: Def } } | null)?._zod?.def ?? null;

/** Every open place in `schema` — the host's strict-inputs rules, over what this schema is built from. */
function openPlaces(schema: unknown, path = "(root)"): string[] {
  const def = defOf(schema);
  if (!def) return [];
  if (def.type === "object") {
    const here = defOf(def.catchall)?.type === "never" ? [] : [`${path} (non-strict object)`];
    const shape = def.shape as Record<string, unknown>;
    return [...here, ...Object.entries(shape).flatMap(([key, child]) => openPlaces(child, `${path}.${key}`))];
  }
  if (["unknown", "any", "custom"].includes(def.type)) return [`${path} (${def.type})`];
  if (def.type === "record") {
    const keyOpen = ["string", "unknown", "any"].includes(defOf(def.keyType)?.type ?? "");
    return [...(keyOpen ? [`${path} (record keyed by any string)`] : []), ...openPlaces(def.valueType, `${path}{}`)];
  }
  if (def.type === "array") return openPlaces(def.element, `${path}[]`);
  if (def.type === "union") return (def.options as unknown[]).flatMap((option) => openPlaces(option, path));
  return "innerType" in def ? openPlaces(def.innerType, path) : [];
}

describe("the converters", () => {
  it("write the maps as keyed lists, in the map's order, empty selections kept", () => {
    expect(toDataViewStateWire(full)).toEqual(wireOfFull);
  });

  it("round-trip every state, from memory and from the wire", () => {
    for (const state of [full, minimal, { ...minimal, ranges: {} }]) {
      expect(fromDataViewStateWire(toDataViewStateWire(state))).toEqual(state);
    }
    expect(toDataViewStateWire(fromDataViewStateWire(wireOfFull))).toEqual(wireOfFull);
  });

  it("survive JSON, which is how the wire shape actually travels", () => {
    const stored = JSON.parse(JSON.stringify(toDataViewStateWire(full))) as unknown;
    expect(readStoredViewState(stored)).toEqual(full);
    // Absent optional keys stay absent rather than arriving as `undefined`.
    expect(Object.keys(toDataViewStateWire(minimal)).sort()).toEqual(["pills", "search", "sortBy", "visibleColumns"]);
  });

  it("do not share arrays with the state they came from", () => {
    const wire = toDataViewStateWire(full);
    wire.pills[0]?.values.push("Dinheiro");
    expect(full.pills.pagamento).toEqual(["Pix", "Cartão"]);
  });
});

describe("dataViewStateWireSchema", () => {
  it("has no open place at any depth", () => {
    expect(openPlaces(dataViewStateWireSchema)).toEqual([]);
  });

  it("accepts what toDataViewStateWire writes", () => {
    for (const state of [full, minimal]) {
      expect(dataViewStateWireSchema.safeParse(toDataViewStateWire(state)).success).toBe(true);
    }
  });

  it("refuses an unknown key at every depth, and the legacy maps", () => {
    for (const bad of [
      { ...wireOfFull, extra: 1 },
      { ...wireOfFull, pills: [{ field: "status", values: [], label: "x" }] },
      { ...wireOfFull, ranges: [{ field: "valor", min: 1, step: 2 }] },
      { ...wireOfFull, sortBy: [{ id: "valor", dir: "desc", nulls: "last" }] },
      { ...wireOfFull, pills: { pagamento: ["Pix"] } },
      { ...wireOfFull, ranges: { valor: { min: 1 } } },
      { ...wireOfFull, layout: "kanban" },
      { ...wireOfFull, pills: [{ field: "", values: [] }] },
    ]) {
      expect(dataViewStateWireSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("reading a stored view, legacy or wire", () => {
  const record = { id: "v1", name: "Abertos", description: null, shared: false, pinned: false, isDefault: false, isOwner: true };

  it("reads a legacy stored view exactly as before", () => {
    const legacy = JSON.parse(JSON.stringify(full)) as unknown;
    expect(toSavedViewSummary({ ...record, state: legacy }).state).toEqual(full);
    // No defaults are filled: an absent `visibleColumns` stays absent, so applying shows every column.
    const sparse = { search: "x", pills: { status: ["aberto"] } };
    expect(toSavedViewSummary({ ...record, state: sparse }).state).toEqual(sparse);
    expect(toSavedViewSummary({ ...record, state: null }).state).toEqual({});
  });

  it("reads a wire stored view as the in-memory state", () => {
    expect(toSavedViewSummary({ ...record, state: wireOfFull }).state).toEqual(full);
  });

  it("applies either shape to the same state", () => {
    const columns = ["pedido", "cliente", "valor"];
    expect(coerceViewState(wireOfFull, columns)).toEqual(coerceViewState(full, columns));
    expect(coerceViewState({ pills: [{ field: "status", values: ["aberto"] }] }, columns)).toMatchObject({
      pills: { status: ["aberto"] },
      ranges: {},
      visibleColumns: columns,
    });
  });

  it("drops a malformed list entry rather than inventing a field", () => {
    const stored = { pills: [{ values: ["x"] }, "junk", { field: "status", values: ["aberto", 3] }], ranges: [{ field: "valor", min: 1 }, null] };
    expect(readStoredViewState(stored)).toEqual({ pills: { status: ["aberto"] }, ranges: { valor: { min: 1 } } });
  });
});
