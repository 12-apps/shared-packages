/**
 * Relatórios data layer (FUT-133): wire types of
 * `GET /api/admin/{slug}/reports/system[/{key}]` and the react-query hooks
 * the pages read. Every run is server-authorized and tenant-scoped; the SPA
 * only decides what to render.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiFetch } from "./lib/api";
import type { ChartSpec } from "@12-apps/ui/charts";

/** The period presets the selector offers (mirrors the API's rolling presets). */
export const REPORT_RANGES = ["today", "7d", "30d"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export const REPORT_RANGE_LABELS: Record<ReportRange, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
};

/** Date-bucket grains for reports that support them. */
export const REPORT_GRAINS = ["day", "week", "month"] as const;
export type ReportGrain = (typeof REPORT_GRAINS)[number];

export const REPORT_GRAIN_LABELS: Record<ReportGrain, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

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
  | { kind: "chart"; chartSpec: ChartSpec; rows: ReportRow[] }
  | {
      kind: "kpi";
      label: string;
      value: number | null;
      /** True when the server withheld the figure for a too-small sample. */
      suppressed?: boolean;
      format: "brl" | "percent" | "compact" | "integer" | "decimal" | "duration";
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
