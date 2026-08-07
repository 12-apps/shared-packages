/**
 * Custom-reports data layer (FUT-138): wire types of the field catalog,
 * saved-report CRUD and the dry-run endpoint, plus the react-query hooks and
 * `restResult` actions the builder/viewer use. The server re-validates every
 * spec against the catalog; the SPA only assembles JSON.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useTransport } from "./transport-context";

import { restResult, type Result } from "./lib/rest-result";
import type { ReportGrain, ReportRange, ReportRender } from "./reports-api";

/** One catalog field as listed by `GET /reports/fields`. */
export interface ReportField {
  field: string;
  label: string;
  type: string;
  role: "dimension" | "measure";
  aggregations?: string[];
  /** Declared render format (`duration`, `percent`…), when the field has one. */
  format?: string;
  description?: string;
  /**
   * The field's closed set of values, labelled (FUT-391). Present means the
   * filter row shows a picker of "Pago" / "Cancelado" instead of a text box —
   * the author never types the stored code, so a typo cannot silently produce
   * a block that matches nothing.
   */
  values?: Array<{ value: string; label: string }>;
  /**
   * The operators this field accepts, resolved SERVER-SIDE. Optional only
   * because a cached response predating this field would omit it; the builder
   * falls back to the full set, which is the pre-FUT-391 behaviour.
   */
  ops?: string[];
  /**
   * Identity dimension (FUT-454): grouping by it requires every measure to
   * declare `minSample` of at least this value; the server rejects the spec
   * otherwise. The builder cannot author `minSample` yet, so a field carrying
   * this is authorable only through a preset or MCP.
   */
  minGroupSample?: number;
  /**
   * Identity-sensitive measure (FUT-454): the server withholds the figure for
   * any row with fewer eligible observations than this, whatever the spec
   * asks. Surfaced so the builder can say WHY a column came back empty.
   */
  identityMinSample?: number;
}

export interface ReportEntityFields {
  entity: string;
  label: string;
  description?: string;
  fields: ReportField[];
  /** Known-good starter spec — the entity's smart default report (FUT-308). */
  starter?: ReportSpecWire;
}

/** The declarative spec assembled by the builder (mirrors @12-apps/report-builder). */
export interface ReportSpecWire {
  entity: string;
  /** Tenant IANA zone for date buckets; the server defaults it (FUT-454). */
  timeZone?: string;
  dimensions: Array<{ field: string; timeGrain?: ReportGrain }>;
  measures: Array<{
    field: string;
    aggregation?: string;
    alias?: string;
    /** `ratio` only: the field summed as the divisor. */
    denominator?: string;
    /** Below this many eligible rows the server withholds the figure. */
    minSample?: number;
    /** Overrides the render format derived from the field. */
    format?: string;
  }>;
  filters: Array<{
    field: string;
    operator: string;
    value?: string | number | boolean;
    values?: Array<string | number | boolean>;
    // Mirrors the core spec exactly, booleans included. A `between` on a
    // boolean is meaningless, but that is a question for the core schema's
    // validation — this type's job is to MIRROR it, and a mirror that
    // disagrees makes a legal template unassignable to a draft.
    from?: string | number | boolean;
    to?: string | number | boolean;
  }>;
  sort: Array<{ by: string; direction: "asc" | "desc" }>;
  limit?: number;
  presentation:
    | { kind: "table" }
    | { kind: "chart"; chartType: "line" | "bar" | "area" | "pie" | "donut"; stacked?: boolean }
    | { kind: "kpi"; label?: string; numberFormat?: string };
}

/** One dashboard block: a regular spec plus layout metadata (FUT-306). */
export interface DashboardBlockWire {
  id: string;
  title?: string;
  span: number;
  spec: ReportSpecWire;
}

/** A multi-block dashboard document, stored like any saved report spec. */
export interface DashboardSpecWire {
  kind: "dashboard";
  blocks: DashboardBlockWire[];
}

/** What a saved document may hold: a single spec or a dashboard. */
export type ReportDocumentWire = ReportSpecWire | DashboardSpecWire;

/** Lifecycle status of a saved document (FUT-307; `archived` FUT-391). */
export type ReportStatusWire = "draft" | "published" | "archived";

/** Sharing rule of a saved document (FUT-307). */
export type ReportVisibilityWire = "tenant" | "roles" | "private";

export interface SavedReportSummary {
  id: string;
  name: string;
  description: string | null;
  type: "report" | "dashboard";
  entity: string;
  entities: string[];
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  updatedAt: string;
}

interface SavedReportViewBase {
  id: string;
  name: string;
  description: string | null;
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  visibilityRoles: string[];
  range: { preset: string; from: string; toExclusive: string };
}

interface SingleReportView extends SavedReportViewBase {
  type: "report";
  spec: ReportSpecWire;
  render: ReportRender;
}

/** One rendered dashboard block: its result, or an inline actionable error. */
export type DashboardBlockRender =
  | {
      id: string;
      title?: string;
      span: number;
      /**
       * What this block asks for, in Portuguese — computed server-side by
       * `specSentence` so the viewer, the editor and an export cannot drift.
       * Optional because a cached response predating it would omit it.
       */
      sentence?: string;
      status: "ok";
      render: ReportRender;
    }
  | {
      id: string;
      title?: string;
      span: number;
      /** Present on a FAILED block too — that is when a reader most needs it. */
      sentence?: string;
      status: "error";
      error: string;
    };

export interface DashboardView extends SavedReportViewBase {
  type: "dashboard";
  spec: DashboardSpecWire;
  blocks: DashboardBlockRender[];
}

export type SavedReportView = SingleReportView | DashboardView;

interface RunResult {
  range: { preset: string; from: string; toExclusive: string };
  render: ReportRender;
}

function adminPath(tenantSlug: string, path: string): string {
  return `/api/admin/${encodeURIComponent(tenantSlug)}${path}`;
}

/**
 * Reads go through the transport in scope (FUT-391), so a host — or a consumer
 * harness with no server at all — can substitute the whole backend. The
 * default transport is the same-origin fetch this used to call directly.
 */
function useAdminFetch(): <T>(path: string) => Promise<T> {
  const transport = useTransport();
  return <T,>(path: string) => transport.get<T>(path);
}

/** The entities/fields this actor may query (server-narrowed by permission). */
export function useReportFields(
  tenantSlug: string,
): UseQueryResult<{ entities: ReportEntityFields[] }> {
  const adminFetch = useAdminFetch();
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "fields"],
    queryFn: () =>
      adminFetch<{ entities: ReportEntityFields[] }>(adminPath(tenantSlug, "/reports/fields")),
    enabled: tenantSlug !== "",
  });
}

export function useSavedReports(
  tenantSlug: string,
): UseQueryResult<{ reports: SavedReportSummary[] }> {
  const adminFetch = useAdminFetch();
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "custom"],
    queryFn: () =>
      adminFetch<{ reports: SavedReportSummary[] }>(adminPath(tenantSlug, "/reports/custom")),
    enabled: tenantSlug !== "",
  });
}

/** Open + run one saved document (report or dashboard) for the period. */
export function useSavedReport(
  tenantSlug: string,
  id: string,
  range: ReportRange,
): UseQueryResult<SavedReportView> {
  const adminFetch = useAdminFetch();
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "custom", id, range],
    queryFn: () =>
      adminFetch<SavedReportView>(
        adminPath(tenantSlug, `/reports/custom/${encodeURIComponent(id)}?preset=${range}`),
      ),
    enabled: tenantSlug !== "" && id !== "",
  });
}

/** One tenant role, as the publish section's allowlist picker needs it. */
interface TenantRoleOption {
  id: string;
  name: string;
}

/**
 * The tenant's roles for the `visibility: "roles"` allowlist picker
 * (FUT-307). Reuses `GET /roles` (roles:manage — the same admin tier that
 * may save documents); pages are unwrapped (`{ data, pagination }`) and the
 * picker walks EVERY page so no role is silently unpickable. The page cap
 * is a runaway guard only — 20 × 100 is far beyond any real tenant.
 */
export function useTenantRoles(
  tenantSlug: string,
  enabled: boolean,
): UseQueryResult<TenantRoleOption[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ["admin", tenantSlug, "roles", "picker"],
    queryFn: async () => {
      const roles: TenantRoleOption[] = [];
      for (let page = 1; page <= 20; page += 1) {
        // The roles endpoint answers with a paginated envelope rather than
        // the `{ data }` one every reports endpoint uses, so this asks the
        // transport for the page itself and reads both halves.
        const result = await transport.getRaw<{
          data: TenantRoleOption[];
          pagination: { hasNextPage: boolean };
        }>(adminPath(tenantSlug, `/roles?page=${page}&pageSize=100`));
        roles.push(...result.data.map((role) => ({ id: role.id, name: role.name })));
        if (!result.pagination.hasNextPage) break;
      }
      return roles;
    },
    enabled: enabled && tenantSlug !== "",
  });
}

/** Dry-run a spec — the engine behind {@link useRunReport}. */
function runReportAction(
  tenantSlug: string,
  spec: ReportSpecWire,
  range: ReportRange,
): Promise<Result<RunResult>> {
  return restResult<RunResult>(adminPath(tenantSlug, "/reports/run"), "POST", {
    spec,
    preset: range,
  });
}

/**
 * Live dry-run of ONE block's spec (FUT-391) — what makes the editor a true
 * WYSIWYG: an edited block re-runs and re-renders through the very same
 * `ReportRenderView` the viewer uses, so "what you see while editing" and
 * "what the saved report shows" cannot drift.
 *
 * Keyed by the spec itself, so identical blocks share one run and an untouched
 * block never re-fetches while its neighbour is being edited. `retry: false`
 * because a spec mid-edit is EXPECTED to be invalid — the compiler's message is
 * the answer to show, not something to retry three times before showing it.
 */
export function useRunReport(
  tenantSlug: string,
  spec: ReportSpecWire | null,
  range: ReportRange,
): UseQueryResult<RunResult> {
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "run", JSON.stringify(spec), range],
    queryFn: async () => {
      if (!spec) throw new Error("Bloco sem consulta.");
      const result = await runReportAction(tenantSlug, spec, range);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: tenantSlug !== "" && spec !== null,
    retry: false,
  });
}

/** Save/update payload; omitted lifecycle fields default server-side. */
interface SaveReportInput {
  name: string;
  description?: string;
  spec: ReportDocumentWire;
  status?: ReportStatusWire;
  visibility?: ReportVisibilityWire;
  visibilityRoles?: string[];
}

export function saveReportAction(
  tenantSlug: string,
  input: SaveReportInput,
): Promise<Result<SavedReportSummary>> {
  return restResult<SavedReportSummary>(adminPath(tenantSlug, "/reports/custom"), "POST", input);
}

export function updateReportAction(
  tenantSlug: string,
  id: string,
  input: SaveReportInput,
): Promise<Result<SavedReportSummary>> {
  return restResult<SavedReportSummary>(
    adminPath(tenantSlug, `/reports/custom/${encodeURIComponent(id)}`),
    "PUT",
    input,
  );
}

/**
 * Archive / restore an open document (FUT-391). Re-sends the document the
 * viewer already holds with only `status` changed — the save endpoint is the
 * one write path, so archiving re-validates exactly like any other edit and
 * needs no second endpoint (nor a second set of permission rules).
 */
export function setReportStatusAction(
  tenantSlug: string,
  view: SavedReportView,
  status: ReportStatusWire,
): Promise<Result<SavedReportSummary>> {
  return updateReportAction(tenantSlug, view.id, {
    name: view.name,
    ...(view.description ? { description: view.description } : {}),
    spec: view.spec,
    status,
    visibility: view.visibility,
    visibilityRoles: view.visibilityRoles,
  });
}
