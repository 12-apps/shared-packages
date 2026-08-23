/**
 * Archiving (and restoring) a report from its CARD (FUT-755).
 *
 * It used to be reachable without this: the area was one screen, so the report
 * you were looking at was rendered under the list and its ⋮ menu was on the
 * page. Splitting the list from the report took that away — archiving now costs
 * a navigation into the report and a navigation back — so the card menu is
 * where the cost has to be paid back.
 *
 * There is ONE write path for a saved document (`PUT /reports/custom/:id`,
 * whole body), which is deliberate: archiving re-validates exactly like any
 * other edit and needs no second endpoint nor a second set of permission
 * rules. The consequence lands here — a card holds a SUMMARY, and a summary
 * carries no `spec`, so the flow is read-then-write: fetch the document the
 * list does not have, then send it back with only `status` changed.
 *
 * That is also the line between what a card menu can and cannot offer.
 * "Duplicar" is deliberately absent rather than silently dropped: it needs the
 * stored spec too, but unlike archiving it needs it as AUTHORED CONTENT, so it
 * would mean either fattening every list response with every document or
 * inventing a copy endpoint. Both are defensible; neither is this change.
 */
import { useState, type JSX } from "react";

import {
  adminReportsPath,
  setReportStatusAction,
  type SavedReportSummary,
  type SavedReportView,
} from "./custom-reports-api";
import { ConfirmDialog } from "./lib/confirm-dialog";
import type { ReportArchiveCopy } from "./screens-copy";
import { useReportCopy, useTransport } from "./transport-context";

/** Archive/restore copy, which differs enough to be worth a lookup. */
function archiveCopy(
  archived: boolean,
  copy: ReportArchiveCopy,
): { action: string; title: string; description: string } {
  if (archived) {
    return {
      action: copy.restoreAction,
      title: copy.restoreTitle,
      description: copy.restoreBody,
    };
  }
  return {
    action: copy.archiveAction,
    title: copy.archiveTitle,
    description: copy.archiveBodyFromList,
  };
}

/**
 * The confirmation for the card menu's archive action.
 *
 * `report` doubles as the open flag: there is no separate boolean that could
 * disagree with it about which report is being archived.
 */
export function ArchiveFromListDialog({
  tenantSlug,
  report,
  onClose,
  onDone,
}: {
  tenantSlug: string;
  report: SavedReportSummary | null;
  onClose: () => void;
  /** The list re-reads the store; the caller owns the query key. */
  onDone: () => void;
}): JSX.Element | null {
  const transport = useTransport();
  const screens = useReportCopy().screens;
  const words = screens.archive;
  const [busy, setBusy] = useState(false);

  if (report === null) return null;
  const archived = report.status === "archived";
  const copy = archiveCopy(archived, words);

  async function run(target: SavedReportSummary): Promise<void> {
    setBusy(true);
    try {
      // The period is irrelevant to a status change — the document comes back
      // the same whatever window it was run for — but the endpoint runs the
      // report to answer, so it needs one.
      const view = await transport.get<SavedReportView>(
        adminReportsPath(tenantSlug, `/reports/custom/${encodeURIComponent(target.id)}?preset=30d`),
      );
      const result = await setReportStatusAction(
        transport,
        tenantSlug,
        view,
        archived ? "published" : "archived",
      );
      if (result.ok) onDone();
    } finally {
      // In `finally`, not after the await: a failed read leaves the dialog
      // closable rather than stuck on "Arquivando…" with no way out.
      setBusy(false);
      onClose();
    }
  }

  return (
    <ConfirmDialog
      open
      title={copy.title}
      description={copy.description}
      confirmText={busy ? words.busy : copy.action}
      cancelText={screens.editor.confirmCancel}
      onConfirm={() => void run(report)}
      onCancel={onClose}
      dataTestId="reports-card-archive-confirm"
    />
  );
}
