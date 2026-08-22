/**
 * Relatórios data layer (FUT-133): wire types of
 * `GET /api/admin/{slug}/reports/system[/{key}]` and the react-query hooks
 * the pages read. Every run is server-authorized and tenant-scoped; the SPA
 * only decides what to render.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiFetch } from "./lib/api";
import type { ChartSpec } from "@12-apps/ui/charts";
import type { ReportRangeCopy } from "./screens-copy";

/**
 * The presets that resolve against the CLOCK, narrow → wide-ish.
 *
 * Every one of these is a complete period on its own: naming it is all the
 * server needs, so it is what a saved report may store as its opening period
 * and what a surface with no picker (the built-in dashboards) offers.
 *
 * "Wide-ish" because `month` is month-TO-DATE, so on the 3rd it is narrower
 * than `7d`. Nothing may read this list as an ordering — see `widen-range.ts`,
 * which keeps its own ladder for exactly that reason.
 */
export const REPORT_ROLLING_RANGES = ["today", "7d", "30d", "month"] as const;
export type ReportRollingRange = (typeof REPORT_ROLLING_RANGES)[number];

/**
 * Everything the period toggle offers, in the order it renders them.
 *
 * `custom` is last and is not a period: it names a window the reader supplies,
 * so its pill opens a picker instead of resolving anything. That is also why it
 * is absent from {@link REPORT_ROLLING_RANGES} rather than merely last in it —
 * a stored default of `custom` would freeze one window forever, and a built-in
 * dashboard offering the pill would send `preset=custom` with no dates and get
 * a 400 from a control that looked fine.
 */
export const REPORT_RANGES = [...REPORT_ROLLING_RANGES, "custom"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/**
 * The period labels, from the host's own words.
 *
 * A lookup rather than the constant it replaces: a preset's NAME is copy, while
 * which presets exist is this package's. `?? range` keeps an unnamed preset
 * showing its id rather than a hole nobody can trace.
 */
export function reportRangeLabel(range: ReportRange, copy: ReportRangeCopy): string {
  return copy.ranges[range] ?? range;
}

/**
 * A period as a SCREEN holds it: the preset, plus the two dates `custom` means.
 *
 * The dates have to travel with the preset everywhere the preset travels. A
 * `custom` that arrives without them is not "a custom range with defaults" —
 * the server has nothing to resolve and answers 400 — and a react-query key
 * that carries only the preset serves one custom window's rows for another,
 * which looks exactly like a period control that does nothing.
 */
export interface ReportRangeSelection {
  preset: ReportRange;
  /** `AAAA-MM-DD`, inclusive. Only read when the preset is `custom`. */
  from?: string;
  /** `AAAA-MM-DD`, inclusive. Only read when the preset is `custom`. */
  to?: string;
}

/**
 * The two shapes a caller may hold a period in, as one.
 *
 * A rolling preset is complete as a bare string and most callers still pass one
 * — so the hooks take either rather than forcing every call site through an
 * object literal that would only ever wrap a single field.
 */
export function rangeSelection(range: ReportRange | ReportRangeSelection): ReportRangeSelection {
  return typeof range === "string" ? { preset: range } : range;
}

/**
 * Whether this period can actually be run. Only `custom` can fail: it is the
 * only preset whose window lives outside the preset name, so a half-picked one
 * must hold the query back rather than send a request that 400s.
 */
export function isRunnableRange(range: ReportRangeSelection): boolean {
  return range.preset !== "custom" || (Boolean(range.from) && Boolean(range.to));
}

/** `preset=…[&from=…&to=…]` — the one place a period becomes a query string. */
export function rangeQuery(range: ReportRangeSelection): string {
  const parts = [`preset=${encodeURIComponent(range.preset)}`];
  if (range.preset === "custom" && range.from && range.to) {
    parts.push(`from=${encodeURIComponent(range.from)}`, `to=${encodeURIComponent(range.to)}`);
  }
  return parts.join("&");
}

/**
 * The period's parts as react-query key segments.
 *
 * Spread into a key rather than passed as the object, so the dates are visible
 * IN the key: two windows of the same preset are two different cached results,
 * and a key that dropped them would hand the first window's rows to the second.
 */
export function rangeQueryKey(range: ReportRangeSelection): [string, string, string] {
  return [range.preset, range.from ?? "", range.to ?? ""];
}

/** Date-bucket grains for reports that support them. */
export const REPORT_GRAINS = ["day", "week", "month"] as const;
export type ReportGrain = (typeof REPORT_GRAINS)[number];

/** The bucket labels, from the host's own words. */
export function reportGrainLabel(grain: ReportGrain, copy: ReportRangeCopy): string {
  return copy.grains[grain] ?? grain;
}

/** One built-in report, as `GET /reports/system` lists it. */
export interface SystemReportSummary {
  key: string;
  title: string;
  description: string;
  presentation: "chart" | "table";
  supportsGrain: boolean;
}

type ReportRowValue = string | number | boolean | null;
export type ReportRow = Record<string, ReportRowValue>;

export interface ReportTableColumn {
  key: string;
  label: string;
  /**
   * Serializable format hint; `brl` values are integer centavos, `duration`
   * values are seconds and `percent` values a 0-1 ratio (FUT-454).
   */
  format: "brl" | "integer" | "decimal" | "text" | "duration" | "percent";
}

/** Rendered report: a table model or a `@12-apps/ui` chart spec, plus rows. */
export type ReportRender =
  | { kind: "table"; columns: ReportTableColumn[]; rows: ReportRow[] }
  | {
      kind: "chart";
      chartSpec: ChartSpec;
      /**
       * The columns the same query would produce as a table — shipped by the
       * server so "Ver como tabela" and the CSV need not re-derive them from
       * the ChartSpec, which no longer carries an x-axis title to derive from.
       *
       * Optional only for a payload produced before FUT-391; the client falls
       * back to the ChartSpec derivation, which yields raw aliases.
       */
      tableColumns?: ReportTableColumn[];
      rows: ReportRow[];
    }
  | {
      kind: "kpi";
      label: string;
      value: number | null;
      /** True when the server withheld the figure for a too-small sample. */
      suppressed?: boolean;
      format: "brl" | "percent" | "compact" | "integer" | "decimal" | "duration";
      /**
       * One figure per measure (FUT-755) — a `Número` block takes one or more.
       * The three fields above are `figures[0]` restated, so a single-measure
       * tile is the payload it always was; optional only for a response
       * produced before the field existed, which `lib/kpi-figures` rebuilds
       * the one figure from.
       */
      figures?: Array<{
        label: string;
        value: number | null;
        suppressed?: boolean;
        format: "brl" | "percent" | "compact" | "integer" | "decimal" | "duration";
      }>;
      rows: ReportRow[];
    };

/** `GET /api/admin/{slug}/reports/system/{key}`. */
interface SystemReportResult {
  key: string;
  title: string;
  description: string;
  supportsGrain: boolean;
  range: { preset: string; from: string; toExclusive: string };
  grain: ReportGrain;
  render: ReportRender;
}

/** Success envelope shared by the whole `/api/admin/**` surface. */
interface ApiEnvelope<T> {
  data: T;
}

function adminPath(tenantSlug: string, path: string): string {
  return `/api/admin/${encodeURIComponent(tenantSlug)}${path}`;
}

async function adminFetch<T>(path: string): Promise<T> {
  const { data } = await apiFetch<ApiEnvelope<T>>(path);
  return data;
}

/**
 * Run one built-in report. Range and grain are part of the query key, so
 * switching either re-queries while previously loaded frames stay cached.
 */
export function useSystemReport(
  tenantSlug: string,
  reportKey: string,
  range: ReportRange,
  grain: ReportGrain,
): UseQueryResult<SystemReportResult> {
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "system", reportKey, range, grain],
    queryFn: () =>
      adminFetch<SystemReportResult>(
        adminPath(
          tenantSlug,
          `/reports/system/${encodeURIComponent(reportKey)}?preset=${range}&grain=${grain}`,
        ),
      ),
    enabled: tenantSlug !== "" && reportKey !== "",
  });
}
