/**
 * Custom-reports data layer (FUT-138): wire types of the field catalog,
 * saved-report CRUD and the dry-run endpoint, plus the react-query hooks and
 * `restResult` actions the builder/viewer use. The server re-validates every
 * spec against the catalog; the SPA only assembles JSON.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useTransport } from "./transport-context";

import { isRunnableRange, rangeQuery, rangeQueryKey, rangeSelection } from "./reports-api";

import type { ReportWorkingCopyWire } from "./custom-reports-write";

import type { Result } from "./lib/rest-result";
import type { ReportBuilderTransport } from "./transport";
import type {
  ReportGrain,
  ReportRange,
  ReportRangeSelection,
  ReportRender,
  ReportRollingRange,
} from "./reports-api";

/** A period as any caller may hold it — a bare rolling preset, or the object. */
type RangeArg = ReportRange | ReportRangeSelection;

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
  /**
   * Blocks in the stored document; a single report is 1 (FUT-755). The list
   * card says it ("3 blocos") and draws its sparkline from it — the one number
   * that tells a single chart apart from a twelve-block dashboard before you
   * open either.
   */
  blockCount: number;
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  /**
   * Whether the SIGNED-IN user authored it — what the `Meus` scope filters on
   * (FUT-755). Resolved server-side, so the client never sees a user id.
   */
  ownedByMe: boolean;
  /**
   * A PUBLISHED report carrying an edit nobody has published yet (FUT-755).
   *
   * Deliberately NOT `status === "draft"`: that says the report was never
   * published at all. This one is live to its readers AND being changed, which
   * is why the card draws it as its own chip. Optional only because a response
   * cached before the field existed omits it — absent reads as "none".
   */
  hasUnpublishedChanges?: boolean;
  updatedAt: string;
}


interface SavedReportViewBase {
  id: string;
  name: string;
  description: string | null;
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  visibilityRoles: string[];
  /** The period it OPENS on (FUT-755), resolved server-side; absent only on a
   * response cached before the field existed, where readers use 30d. Rolling
   * only — a stored `custom` would open the report on a frozen window. */
  defaultRange?: ReportRollingRange;
  /**
   * The parked edit, present only for a caller who may AUTHOR (FUT-755).
   *
   * Everything else on this view is the PUBLISHED document, for everyone: a
   * reader opening a report while its author edits sees what is live. The
   * editor is the only screen that looks at this field, and resuming it is the
   * whole point — reopening must land you back where you stopped.
   */
  workingCopy?: ReportWorkingCopyWire | null;
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

/** Exported for `custom-reports-write`: one place decides the URL shape. */
export function adminReportsPath(tenantSlug: string, path: string): string {
  return `/api/admin/${encodeURIComponent(tenantSlug)}${path}`;
}

const adminPath = adminReportsPath;

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

/**
 * Open + run one saved document (report or dashboard) for the period.
 *
 * This built `?preset=${range}` by hand and keyed on the bare preset, which a
 * custom window breaks in both directions at once: the request loses its dates
 * and resolves as something else, and the answer is filed under a key every
 * OTHER custom window also hits. Both now come off the same two helpers.
 */
export function useSavedReport(
  tenantSlug: string,
  id: string,
  range: RangeArg,
): UseQueryResult<SavedReportView> {
  const adminFetch = useAdminFetch();
  const selection = rangeSelection(range);
  return useQuery({
    queryKey: ["admin", tenantSlug, "reports", "custom", id, ...rangeQueryKey(selection)],
    queryFn: () =>
      adminFetch<SavedReportView>(
        adminPath(
          tenantSlug,
          `/reports/custom/${encodeURIComponent(id)}?${rangeQuery(selection)}`,
        ),
      ),
    // A half-picked custom window holds the query rather than sending a request
    // the server can only answer with 400.
    enabled: tenantSlug !== "" && id !== "" && isRunnableRange(selection),
  });
}

/**
 * Dry-run a spec — the engine behind {@link useRunReport}.
 *
 * Every write on this surface takes the transport explicitly, for the same
 * reason the reads go through it: it is the package's ONLY I/O seam, and a
 * write that reached for `fetch` directly would leave a host that supplied a
 * transport with its reads intercepted and its writes escaping to the origin.
 */
function runReportAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  spec: ReportSpecWire,
  range: ReportRangeSelection,
): Promise<Result<RunResult>> {
  return transport.send<RunResult>(adminPath(tenantSlug, "/reports/run"), "POST", {
    spec,
    preset: range.preset,
    // The dry run reads its period from the BODY (`windowOfBody`), so a custom
    // window's dates ride there rather than on a query string.
    ...(range.preset === "custom" && range.from && range.to
      ? { from: range.from, to: range.to }
      : {}),
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
  range: RangeArg,
): UseQueryResult<RunResult> {
  const transport = useTransport();
  const selection = rangeSelection(range);
  return useQuery({
    queryKey: [
      "admin",
      tenantSlug,
      "reports",
      "run",
      JSON.stringify(spec),
      ...rangeQueryKey(selection),
    ],
    queryFn: async () => {
      if (!spec) throw new Error("Bloco sem consulta.");
      const result = await runReportAction(transport, tenantSlug, spec, selection);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: tenantSlug !== "" && spec !== null && isRunnableRange(selection),
    retry: false,
  });
}

/**
 * The WRITE half — save, update and archive — lives in `custom-reports-write`
 * and is re-exported here so every caller keeps one import path for the
 * reports API. Split because this module is at the size gate's ceiling and the
 * writes are the part with no query wiring in them.
 */
export {
  discardWorkingCopyAction,
  publishWorkingCopyAction,
  saveReportAction,
  saveWorkingCopyAction,
  setReportStatusAction,
  updateReportAction,
  type ReportWorkingCopyWire,
} from "./custom-reports-write";
