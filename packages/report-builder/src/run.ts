import { compileReport } from './compile';
import { specSentence } from './describe';
import { invalidSpecError, ReportBuilderError } from './errors';
import { renderReport, type ReportRenderModel } from './render';
import {
  dashboardSpecSchema,
  describeSpecIssues,
  isDashboardInput,
  isDashboardSpec,
  reportSpecSchema,
  type DashboardSpec,
  type ReportDocument,
  type ReportSpec,
} from './spec';
import type { CompiledQuery, FieldCatalog, ReportDataSource, ReportRow } from './types';

export interface RunReportOptions {
  catalog: FieldCatalog;
  adapter: ReportDataSource;
  /** Hard host-side row cap (e.g. for LLM-facing endpoints). */
  maxRows?: number;
  /**
   * The calling tenant's IANA zone for date buckets (FUT-454), used when the
   * spec does not name its own. Without this the middle rung of compile's
   * "spec → host → America/Sao_Paulo" chain was unreachable from here.
   */
  timeZone?: string;
}

export interface ReportRunResult {
  spec: ReportSpec;
  query: CompiledQuery;
  rows: ReportRow[];
  render: ReportRenderModel;
}

/** Parse an untrusted spec value, throwing an LLM-friendly error on failure. */
export function parseReportSpec(input: unknown): ReportSpec {
  const parsed = reportSpecSchema.safeParse(input);
  if (!parsed.success) throw invalidSpecError(describeSpecIssues(parsed.error));
  return parsed.data;
}

/**
 * End-to-end pipeline: validate (zod) → compile against the catalog →
 * execute through the adapter → render (table model or ChartSpec).
 */
export async function runReport(input: unknown, options: RunReportOptions): Promise<ReportRunResult> {
  const spec = parseReportSpec(input);
  const query = compileReport(spec, options.catalog, {
    maxRows: options.maxRows,
    timeZone: options.timeZone,
  });
  const rows = (await options.adapter.execute(query)).slice(0, query.limit);
  const render = renderReport(query, spec.presentation, options.catalog, rows);
  return { spec, query, rows, render };
}

/**
 * Parse an untrusted DOCUMENT value — a single spec or a dashboard (FUT-306).
 * Branches on `kind` before validating, so a malformed dashboard reports
 * dashboard issues only (never the single-spec branch's noise), and vice
 * versa. Throws an LLM-friendly error on failure.
 */
export function parseReportDocument(input: unknown): ReportDocument {
  if (isDashboardInput(input)) {
    const parsed = dashboardSpecSchema.safeParse(input);
    if (!parsed.success) throw invalidSpecError(describeSpecIssues(parsed.error));
    return parsed.data;
  }
  return parseReportSpec(input);
}

export interface DashboardBlockSuccess {
  id: string;
  title?: string;
  span: number;
  /**
   * The block's spec in Portuguese ({@link specSentence}) — computed HERE, on
   * the server, so the viewer, the editor and an export all render the same
   * words. Deriving it per surface would let three copies drift, and only the
   * server holds the catalog the labels come from.
   */
  sentence: string;
  status: 'ok';
  spec: ReportSpec;
  query: CompiledQuery;
  rows: ReportRow[];
  render: ReportRenderModel;
}

export interface DashboardBlockFailure {
  id: string;
  title?: string;
  span: number;
  /**
   * Present on a FAILED block too: a block whose spec no longer compiles is
   * exactly when a reader needs to know what it was asking for. `specSentence`
   * never throws, so this is always available.
   */
  sentence: string;
  status: 'error';
  /** The report-builder error message (actionable, same text a 400 carries). */
  error: string;
}

export type DashboardBlockResult = DashboardBlockSuccess | DashboardBlockFailure;

export interface DashboardRunResult {
  spec: DashboardSpec;
  blocks: DashboardBlockResult[];
}

/**
 * Run every block of a dashboard document IN PARALLEL (FUT-306), each through
 * the full {@link runReport} pipeline. A block whose spec no longer compiles
 * (catalog drift on a stored dashboard) degrades to an inline `status:
 * "error"` result so the other blocks still render; infrastructure failures
 * (adapter/database errors) still reject the whole run.
 */
export async function runDashboard(
  input: unknown,
  options: RunReportOptions,
): Promise<DashboardRunResult> {
  const doc = parseReportDocument(input);
  if (!isDashboardSpec(doc)) {
    throw invalidSpecError('Expected a dashboard document (kind: "dashboard").');
  }
  const blocks = await Promise.all(
    doc.blocks.map(async (block): Promise<DashboardBlockResult> => {
      const base = {
        id: block.id,
        title: block.title,
        span: block.span,
        sentence: specSentence(block.spec, options.catalog),
      };
      try {
        const result = await runReport(block.spec, options);
        return { ...base, status: 'ok', ...result };
      } catch (error) {
        if (error instanceof ReportBuilderError) {
          return { ...base, status: 'error', error: error.message };
        }
        throw error;
      }
    }),
  );
  return { spec: doc, blocks };
}
