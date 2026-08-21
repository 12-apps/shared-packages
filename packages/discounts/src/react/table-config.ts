import type {
  DataViewColumn,
  DataViewQuery,
  DataViewState,
  FilterFieldConfig,
} from "@12-apps/ui/data-display/DataViews";
import type { ExportColumn } from "@12-apps/ui/utils";

import {
  DISCOUNT_SCOPES,
  DISCOUNT_TRIGGERS,
  DISCOUNT_TYPES,
  DISCOUNT_WINDOW_STATES,
} from "../engine/kinds";

import type { DiscountsWebCopy } from "./copy";
import { EMPTY } from "./format";
import type { DiscountListItem } from "./row";

/**
 * The grid's columns, pills and export, plus the URL ⇄ query plumbing.
 *
 * The pill VALUES are the WIRE values and only the labels are translated. That
 * is what lets a selection be forwarded straight into the backend query with no
 * second mapping table to drift out of step with the search config — and it is
 * why `DISCOUNT_WINDOW_STATES` are English tokens rather than the words on the
 * pill: the origin filtered on its own pt-BR labels, so its wire protocol was
 * its language.
 */

/** The grid-owned URL params, forwarded verbatim to the backend query. */
const OWNED_PARAMS = [
  "q",
  "page",
  "sort",
  "type_in",
  "scope_in",
  "trigger_in",
  "active",
  "window",
] as const;

/** A CODE rule is identified by its coupon, not by the word "code". */
function triggerCell(row: DiscountListItem, copy: DiscountsWebCopy): string {
  if (row.trigger === "CODE") return row.code ?? EMPTY;
  return copy.labels.trigger[row.trigger as keyof typeof copy.labels.trigger] ?? row.trigger;
}

/** One label out of a pack, falling back to the raw stored value. */
function labelled(labels: Readonly<Record<string, string>>, value: string): string {
  // The closed sets live in the database as CHECK constraints, so a value that
  // arrives unknown means the set was widened server-side — and a list that
  // renders `PERCENTAGE` is far better than one that renders a crash.
  return labels[value] ?? value;
}

export function discountColumns(copy: DiscountsWebCopy): DataViewColumn<DiscountListItem>[] {
  return [
    { id: "name", header: copy.screen.columns.name, accessor: "name", searchable: true },
    // Pre-formatted by the page: a cell must not do arithmetic on basis points.
    { id: "value", header: copy.screen.columns.value, accessor: (row) => row.valueLabel },
    {
      id: "type",
      header: copy.screen.columns.type,
      accessor: (row) => labelled(copy.labels.type, row.type),
    },
    {
      id: "scope",
      header: copy.screen.columns.scope,
      accessor: (row) => labelled(copy.labels.scope, row.scope),
    },
    {
      id: "trigger",
      header: copy.screen.columns.trigger,
      accessor: (row) => triggerCell(row, copy),
      searchable: true,
    },
    { id: "window", header: copy.screen.columns.window, accessor: (row) => row.windowLabel },
    {
      id: "usageCount",
      header: copy.screen.columns.usageCount,
      accessor: (row) => String(row.usageCount),
    },
    {
      id: "active",
      header: copy.screen.columns.active,
      accessor: (row) => (row.active ? copy.screen.yes : copy.screen.no),
    },
  ];
}

/** One closed set as filter options: wire values, translated labels. */
function pillOptions<TKey extends string>(
  values: readonly TKey[],
  labels: Readonly<Record<TKey, string>>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export function discountFilters(copy: DiscountsWebCopy): FilterFieldConfig<DiscountListItem>[] {
  return [
    {
      id: "type",
      label: copy.screen.columns.type,
      accessor: (row) => row.type,
      options: pillOptions(DISCOUNT_TYPES, copy.labels.type),
    },
    {
      id: "scope",
      label: copy.screen.columns.scope,
      accessor: (row) => row.scope,
      options: pillOptions(DISCOUNT_SCOPES, copy.labels.scope),
    },
    {
      id: "trigger",
      label: copy.screen.columns.trigger,
      accessor: (row) => row.trigger,
      options: pillOptions(DISCOUNT_TRIGGERS, copy.labels.trigger),
    },
    {
      id: "active",
      label: copy.screen.columns.active,
      accessor: (row) => (row.active ? "true" : "false"),
      options: [
        { value: "true", label: copy.screen.yes },
        { value: "false", label: copy.screen.no },
      ],
    },
    {
      id: "window",
      label: copy.screen.columns.window,
      accessor: (row) => row.windowState,
      options: pillOptions(DISCOUNT_WINDOW_STATES, copy.labels.window),
    },
  ];
}

export function discountExportColumns(
  copy: DiscountsWebCopy,
): ExportColumn<DiscountListItem>[] {
  return [
    { header: copy.screen.columns.name, value: (row) => row.name },
    { header: copy.screen.columns.value, value: (row) => row.valueLabel },
    { header: copy.screen.columns.type, value: (row) => labelled(copy.labels.type, row.type) },
    { header: copy.screen.columns.scope, value: (row) => labelled(copy.labels.scope, row.scope) },
    {
      header: copy.screen.columns.trigger,
      value: (row) => labelled(copy.labels.trigger, row.trigger),
    },
    { header: copy.screen.columns.code, value: (row) => row.code ?? "" },
    { header: copy.screen.columns.window, value: (row) => row.windowLabel },
    { header: copy.screen.columns.usageCount, value: (row) => String(row.usageCount) },
    {
      header: copy.screen.columns.active,
      value: (row) => (row.active ? copy.screen.yes : copy.screen.no),
    },
  ];
}

/** A comma-joined `_in` list, or undefined when the pill is untouched. */
function inList(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

/** A single-choice pill, or undefined when both or neither option is picked. */
function oneOf(values: string[] | undefined, allowed: readonly string[]): string | undefined {
  const picked = values?.length === 1 ? values[0] : undefined;
  return picked !== undefined && allowed.includes(picked) ? picked : undefined;
}

/**
 * Map the grid's query into the backend's search params. An omitted key clears
 * its param from the URL, so a dropped filter never lingers.
 */
export function discountsQueryToParams(
  query: DataViewQuery,
): Record<string, string | undefined> {
  const sort = query.sortBy[0];
  return {
    q: query.search || undefined,
    page: query.page > 1 ? String(query.page) : undefined,
    sort: sort && sort.dir ? `${sort.id}:${sort.dir}` : undefined,
    type_in: inList(query.pills.type),
    scope_in: inList(query.pills.scope),
    trigger_in: inList(query.pills.trigger),
    active: oneOf(query.pills.active, ["true", "false"]),
    window: oneOf(query.pills.window, DISCOUNT_WINDOW_STATES),
  };
}

/** The filter pills encoded in the URL. */
function pillsFromParams(params: URLSearchParams): Record<string, string[]> {
  const pills: Record<string, string[]> = {};
  for (const [param, id] of [
    ["type_in", "type"],
    ["scope_in", "scope"],
    ["trigger_in", "trigger"],
  ] as const) {
    const raw = params.get(param);
    if (raw) pills[id] = raw.split(",");
  }
  const active = params.get("active");
  if (active === "true" || active === "false") pills.active = [active];
  const window = params.get("window");
  if (window && DISCOUNT_WINDOW_STATES.some((state) => state === window)) pills.window = [window];
  return pills;
}

/**
 * Seed the grid's client state from the URL, so a bookmarked filtered link is
 * reflected on first render — otherwise the empty client state emits an
 * unfiltered query and wipes the params the operator arrived with.
 */
export function discountsAppliedState(
  params: URLSearchParams,
  copy: DiscountsWebCopy,
): DataViewState {
  const [sortField, sortDir] = (params.get("sort") ?? "").split(":");
  const sortBy: DataViewState["sortBy"] =
    sortField && sortDir ? [{ id: sortField, dir: sortDir === "desc" ? "desc" : "asc" }] : [];
  return {
    search: params.get("q") ?? "",
    pills: pillsFromParams(params),
    ranges: {},
    sortBy,
    visibleColumns: discountColumns(copy).map((column) => column.id),
  };
}

/** The discounts query string for the current URL — only the params we own. */
export function discountsSearch(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of OWNED_PARAMS) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}
