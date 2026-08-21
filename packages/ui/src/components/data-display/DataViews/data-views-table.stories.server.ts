import type { DataViewQuery, RangeValue } from "./data-views-types";

/**
 * THE "SERVER" FOR THE PEDIDOS STORY.
 *
 * It is named for its one consumer — `data-views-table.stories.tsx` — and the
 * `.stories.` infix is load-bearing rather than decorative: this package's
 * `files` carries `!**\/*.stories.*`, so the name is what keeps a Storybook
 * fixture out of the published tarball. As `pedidos.server.ts` it shipped, and
 * a generic component library was handing every adopter a row type spelled
 * `pedido`, `cliente`, `situacao`. The copy-portability gate could not see it
 * (no diacritics) and the story exclusions did not match the name, so it sat in
 * `src/` unremarked. The Portuguese itself is fine and stays: a story IS
 * product copy. Shipping one to strangers is what was not.
 *
 * Server mode means the grid does not filter, sort or paginate — it emits the
 * query and renders exactly the page it is handed back. A story that wires
 * `onQueryChange` to a no-op spy therefore looks broken in a specific and
 * misleading way: the pills apply, the counter never moves, and every row
 * stays. The controls are working; there is simply nobody on the other end.
 *
 * So this is the other end. It is deliberately fenced into its own module and
 * written the way the real endpoint is: it is the ONLY code allowed to narrow
 * the dataset, and the story never reaches past `data`.
 */

/** The subset of a row this fake backend knows how to query. */
export interface ServerRow extends Record<string, unknown> {
  pedido: string;
  cliente: string;
  metodo: string;
  pagamento: string;
  situacao: string;
  dataIso: string;
  valor: number;
}

export interface ServerPage<T> {
  data: T[];
  totalCount: number;
  /**
   * Per-scope totals over search + pills + ranges, IGNORING the active scope —
   * computed with it applied, every inactive tab reads zero.
   */
  scopeCounts: Record<string, number>;
}

/** A row matches a pill field when ANY selected value matches. */
function matchesPills(row: ServerRow, pills: Record<string, string[]>): boolean {
  return Object.entries(pills).every(([fieldId, values]) => {
    if (!values || values.length === 0) return true;
    return values.includes(String(row[fieldId] ?? ""));
  });
}

/**
 * Ranges. A DAY bound is compared as an ISO STRING, never coerced to a
 * timestamp: turning an `até` of 2026-07-15 into an instant lands on that day's
 * midnight and silently drops the final day (FUT-668). Both ends are inclusive.
 */
function matchesRanges(row: ServerRow, ranges: Record<string, RangeValue>): boolean {
  return Object.entries(ranges).every(([fieldId, range]) => {
    if (!range || (range.min == null && range.max == null)) return true;
    const value = fieldId === "data" ? row.dataIso : row.valor;
    if (value == null) return false;
    if (range.min != null && value < range.min) return false;
    if (range.max != null && value > range.max) return false;
    return true;
  });
}

function matchesSearch(row: ServerRow, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [row.pedido, row.cliente, row.metodo].some((field) =>
    String(field).toLowerCase().includes(term),
  );
}

/** The scopes this story declares, as predicates over a row's `situacao`. */
const SCOPES: Record<string, (row: ServerRow) => boolean> = {
  todos: () => true,
  "Em aberto": (row) => row.situacao === "Em aberto",
  Cancelado: (row) => row.situacao === "Cancelado",
};

function compare(a: ServerRow, b: ServerRow, id: string): number {
  const left = a[id];
  const right = b[id];
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), "pt-BR");
}

/**
 * Answer one query: narrow, count, scope, sort, then cut the page.
 *
 * `scopeCounts` is computed BEFORE the scope is applied, which is the whole
 * reason it cannot be done in the browser — a count taken from the loaded page
 * is wrong the moment there is a second page.
 */
export function queryPedidos(rows: ServerRow[], query: DataViewQuery): ServerPage<ServerRow> {
  const narrowed = rows.filter(
    (row) =>
      matchesSearch(row, query.search) &&
      matchesPills(row, query.pills) &&
      matchesRanges(row, query.ranges ?? {}),
  );

  const scopeCounts = Object.fromEntries(
    Object.entries(SCOPES).map(([id, predicate]) => [id, narrowed.filter(predicate).length]),
  );

  const predicate = query.scope ? SCOPES[query.scope] : undefined;
  const scoped = predicate ? narrowed.filter(predicate) : narrowed;

  const sorted = [...scoped];
  const sort = query.sortBy?.[0];
  if (sort) {
    sorted.sort((a, b) => (sort.dir === "asc" ? compare(a, b, sort.id) : compare(b, a, sort.id)));
  }

  const start = (query.page - 1) * query.pageSize;
  return {
    data: sorted.slice(start, start + query.pageSize),
    totalCount: scoped.length,
    scopeCounts,
  };
}
