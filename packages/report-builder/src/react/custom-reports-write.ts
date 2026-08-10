/**
 * Writes against the saved-reports API: create, update, and the archive /
 * restore that rides the same endpoint.
 *
 * Separated from `custom-reports-api` (which is queries and their types) so
 * neither half has to grow past the size gate to gain a field. Everything here
 * is re-exported from there, so callers import one module.
 */
import type {
  ReportDocumentWire,
  ReportStatusWire,
  ReportVisibilityWire,
  SavedReportSummary,
  SavedReportView,
} from "./custom-reports-api";
import { adminReportsPath } from "./custom-reports-api";
import type { ReportRange } from "./reports-api";
import type { Result } from "./lib/rest-result";
import type { ReportBuilderTransport } from "./transport";

/** Save/update payload; omitted lifecycle fields default server-side. */
interface SaveReportInput {
  name: string;
  description?: string;
  spec: ReportDocumentWire;
  status?: ReportStatusWire;
  visibility?: ReportVisibilityWire;
  visibilityRoles?: string[];
  /** Omitted keeps the stored preference; null clears it back to 30 dias. */
  defaultRange?: ReportRange | null;
}

export function saveReportAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  input: SaveReportInput,
): Promise<Result<SavedReportSummary>> {
  return transport.send<SavedReportSummary>(
    adminReportsPath(tenantSlug, "/reports/custom"),
    "POST",
    input,
  );
}

export function updateReportAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  id: string,
  input: SaveReportInput,
): Promise<Result<SavedReportSummary>> {
  return transport.send<SavedReportSummary>(
    adminReportsPath(tenantSlug, `/reports/custom/${encodeURIComponent(id)}`),
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
  transport: ReportBuilderTransport,
  tenantSlug: string,
  view: SavedReportView,
  status: ReportStatusWire,
): Promise<Result<SavedReportSummary>> {
  return updateReportAction(transport, tenantSlug, view.id, {
    name: view.name,
    ...(view.description ? { description: view.description } : {}),
    spec: view.spec,
    status,
    visibility: view.visibility,
    visibilityRoles: view.visibilityRoles,
    ...(view.defaultRange ? { defaultRange: view.defaultRange } : {}),
  });
}
