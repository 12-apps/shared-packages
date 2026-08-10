/**
 * Writes against the saved-reports API: create, update, the archive / restore
 * that rides the same endpoint, and the three writes of a working copy — the
 * unpublished changes a PUBLISHED report carries (FUT-755).
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
import type { ReportRollingRange } from "./reports-api";
import type { Result } from "./lib/rest-result";
import type { ReportBuilderTransport } from "./transport";

/**
 * Everything a save persists — and, by design rather than by coincidence, the
 * exact shape of a WORKING COPY: the author's in-progress edit to a PUBLISHED
 * report, parked beside the live document instead of over it (FUT-755).
 *
 * Parking an edit and publishing it are the same payload sent to two endpoints
 * that make different promises about the live document, so there is one object
 * to build and no translation step that could drop a field on one path and keep
 * it on the other.
 *
 * `name` may be empty when it is being PARKED. An autosave fires mid-edit, and
 * mid-edit is exactly when a name is briefly blank because it was selected and
 * is being retyped; the strict check happens where it decides something — on
 * publish. Omitted lifecycle fields keep their stored values server-side.
 */
export interface ReportWorkingCopyWire {
  name: string;
  description?: string | null;
  spec: ReportDocumentWire;
  status?: ReportStatusWire;
  visibility?: ReportVisibilityWire;
  visibilityRoles?: string[];
  /** Omitted keeps the stored preference; null clears it back to 30 dias. */
  defaultRange?: ReportRollingRange | null;
}

type SaveReportInput = ReportWorkingCopyWire;

/** Where a report's working copy lives, relative to the reports mount. */
function workingCopyPath(tenantSlug: string, id: string): string {
  return adminReportsPath(tenantSlug, `/reports/custom/${encodeURIComponent(id)}/working-copy`);
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
 * Autosave the author's in-progress edit to a PUBLISHED report (FUT-755).
 *
 * The live document is NOT written: readers keep getting the published version
 * until the author publishes. The server validates the shape but does not
 * compile the spec against the field catalog, because a spec mid-edit is
 * legitimately incomplete and refusing to park it would lose exactly the work
 * this endpoint exists to keep.
 */
export function saveWorkingCopyAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  id: string,
  input: SaveReportInput,
): Promise<Result<{ saved: boolean }>> {
  return transport.send<{ saved: boolean }>(workingCopyPath(tenantSlug, id), "PUT", input);
}

/**
 * Publish the edit: it becomes the live document and the parked copy is
 * dropped, in one server-side write.
 *
 * It sends the editor's CURRENT state rather than relying on whatever the last
 * autosave managed to store — publishing has to mean "what I am looking at",
 * and a debounce that had not fired yet would otherwise publish the keystroke
 * before last.
 */
export function publishWorkingCopyAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  id: string,
  input: SaveReportInput,
): Promise<Result<SavedReportSummary>> {
  return transport.send<SavedReportSummary>(
    `${workingCopyPath(tenantSlug, id)}/publish`,
    "POST",
    input,
  );
}

/** Throw the parked edit away; the published document was never touched. */
export function discardWorkingCopyAction(
  transport: ReportBuilderTransport,
  tenantSlug: string,
  id: string,
): Promise<Result<{ discarded: boolean }>> {
  return transport.send<{ discarded: boolean }>(workingCopyPath(tenantSlug, id), "DELETE");
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
