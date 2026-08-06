import { describe, expect, it } from "vitest";

import { viewStateKey } from "../data-views-dirty";
import type { DataViewState } from "../data-views-types";

const base: DataViewState = {
  search: "",
  pills: {},
  ranges: {},
  sortBy: [],
  visibleColumns: ["pedido", "cliente", "valor"],
};

describe("viewStateKey", () => {
  it("treats a filter APPLIED AND REMOVED as identical to never having set it", () => {
    // The bug this exists for: clearing a pill leaves an empty array behind
    // rather than deleting the key, so the raw JSON differed and the view
    // stayed "dirty" over a state identical to the one it started from — with
    // "Redefinir" the only way back from a change already undone.
    const cleared: DataViewState = { ...base, pills: { pagamento: [] } };
    expect(viewStateKey(cleared)).toBe(viewStateKey(base));
  });

  it("treats an emptied RANGE the same way", () => {
    const cleared: DataViewState = { ...base, ranges: { valor: {} } };
    expect(viewStateKey(cleared)).toBe(viewStateKey(base));
  });

  it("still reports a filter that IS applied", () => {
    const applied: DataViewState = { ...base, pills: { pagamento: ["Pendente"] } };
    expect(viewStateKey(applied)).not.toBe(viewStateKey(base));
  });

  it("ignores the ORDER values were picked in — a set, not a sequence", () => {
    const ab: DataViewState = { ...base, pills: { situacao: ["Em aberto", "Cancelado"] } };
    const ba: DataViewState = { ...base, pills: { situacao: ["Cancelado", "Em aberto"] } };
    expect(viewStateKey(ab)).toBe(viewStateKey(ba));
  });

  it("ignores the order of visibleColumns, which is a set — `order` carries reading order", () => {
    const reordered: DataViewState = { ...base, visibleColumns: ["valor", "pedido", "cliente"] };
    expect(viewStateKey(reordered)).toBe(viewStateKey(base));
    // …but an explicit reading order IS a change.
    const withOrder: DataViewState = { ...base, order: ["valor", "pedido", "cliente"] };
    expect(viewStateKey(withOrder)).not.toBe(viewStateKey(base));
  });

  it("ignores surrounding whitespace in the search", () => {
    expect(viewStateKey({ ...base, search: "  " })).toBe(viewStateKey(base));
    expect(viewStateKey({ ...base, search: " burg " })).toBe(viewStateKey({ ...base, search: "burg" }));
  });

  it("reports a HIDDEN column, a sort and a scope as changes", () => {
    expect(viewStateKey({ ...base, visibleColumns: ["pedido"] })).not.toBe(viewStateKey(base));
    expect(viewStateKey({ ...base, sortBy: [{ id: "valor", dir: "asc" }] })).not.toBe(viewStateKey(base));
    expect(viewStateKey({ ...base, scope: "cancelados" })).not.toBe(viewStateKey(base));
  });
});
