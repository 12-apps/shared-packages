import { describe, expect, it } from "vitest";

import type { DataViewQuery } from "@12-apps/ui/data-display/DataViews";

import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import {
  discountFilters,
  discountsAppliedState,
  discountsQueryToParams,
  discountsSearch,
} from "../table-config";

/**
 * The URL ⇄ query plumbing, and the property that makes it work at all: the
 * pill VALUES are wire values and only the LABELS are translated.
 *
 * The origin filtered on its own pt-BR labels, so its wire protocol was its
 * language — a second host in another language could not use its own words
 * without changing what the backend receives. These cases pin the separation in
 * both directions, because a round trip that silently dropped a filter looks
 * exactly like a filter nobody applied.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;

function query(overrides: Partial<DataViewQuery> = {}): DataViewQuery {
  return {
    search: "",
    pills: {},
    ranges: {},
    sortBy: [],
    page: 1,
    pageSize: 20,
    ...overrides,
  } as DataViewQuery;
}

describe("the pills speak wire, and read as words", () => {
  it("V1: offers every member of each closed set, valued by its wire token", () => {
    const window = discountFilters(copy).find((field) => field.id === "window");
    expect(window?.options).toEqual([
      { value: "RUNNING", label: "Vigente" },
      { value: "SCHEDULED", label: "Agendado" },
      { value: "ENDED", label: "Encerrado" },
    ]);
  });

  it("V2: values the boolean pill as `true`/`false`, not as its two words", () => {
    const active = discountFilters(copy).find((field) => field.id === "active");
    expect(active?.options.map((option) => option.value)).toEqual(["true", "false"]);
  });
});

describe("a selection becomes search params", () => {
  it("V3: joins a multi-pick pill into the `_in` list the backend parses", () => {
    expect(discountsQueryToParams(query({ pills: { type: ["PERCENTAGE", "FREE_UNITS"] } }))).toMatchObject(
      { type_in: "PERCENTAGE,FREE_UNITS" },
    );
  });

  it("V4: omits an untouched pill, so a dropped filter does not linger", () => {
    // An omitted key CLEARS its param. Emitting an empty string instead would
    // leave `?type_in=` in the URL and in every link the operator shares.
    expect(discountsQueryToParams(query()).type_in).toBeUndefined();
    expect(discountsQueryToParams(query({ pills: { type: [] } })).type_in).toBeUndefined();
  });

  it("V5: ignores a single-choice pill with both options picked", () => {
    // "Active AND inactive" is every row, which is what no filter means.
    expect(discountsQueryToParams(query({ pills: { active: ["true", "false"] } })).active)
      .toBeUndefined();
  });

  it("V6: omits page 1, so the default URL stays clean", () => {
    expect(discountsQueryToParams(query()).page).toBeUndefined();
    expect(discountsQueryToParams(query({ page: 3 })).page).toBe("3");
  });

  it("V7: encodes a sort as `field:direction`", () => {
    expect(discountsQueryToParams(query({ sortBy: [{ id: "name", dir: "desc" }] })).sort).toBe(
      "name:desc",
    );
  });
});

describe("a URL becomes the grid's applied state", () => {
  const state = (search: string) =>
    discountsAppliedState(new URLSearchParams(search), copy);

  it("V8: seeds every pill a link carried", () => {
    expect(state("?q=bebidas&type_in=PERCENTAGE&active=true&window=RUNNING")).toMatchObject({
      search: "bebidas",
      pills: { type: ["PERCENTAGE"], active: ["true"], window: ["RUNNING"] },
    });
  });

  it("V9: ignores a window value that is not one of the three", () => {
    // A hand-edited or stale URL must not seed a pill the grid cannot render.
    expect(state("?window=Vigente").pills.window).toBeUndefined();
  });

  it("V10: survives the round trip a shared link actually makes", () => {
    const params = "type_in=PERCENTAGE%2CFREE_UNITS&active=false&window=ENDED&q=verao&sort=name%3Adesc";
    const applied = state(`?${params}`);
    const back = discountsQueryToParams(
      query({ search: applied.search, pills: applied.pills, sortBy: applied.sortBy }),
    );
    expect(back).toMatchObject({
      q: "verao",
      type_in: "PERCENTAGE,FREE_UNITS",
      active: "false",
      window: "ENDED",
      sort: "name:desc",
    });
  });
});

describe("which params travel", () => {
  it("V11: forwards only the ones the grid OWNS", () => {
    // Another owner's param (`?view=`, `?edit=`) must not reach the backend as
    // an unknown filter, and must not be dropped from the URL either.
    const search = discountsSearch(new URLSearchParams("?q=x&view=row-7&page=2&nonsense=1"));
    expect(new URLSearchParams(search).get("q")).toBe("x");
    expect(new URLSearchParams(search).get("page")).toBe("2");
    expect(new URLSearchParams(search).get("view")).toBeNull();
    expect(new URLSearchParams(search).get("nonsense")).toBeNull();
  });
});
