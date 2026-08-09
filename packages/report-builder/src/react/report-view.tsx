/**
 * Report VIEW mode (FUT-391): the selected report's canvas, plus the ⋮ menu
 * that edits or archives it. Blocks arrive already run by the server (one
 * round trip for the whole report) and land on the shared `ReportGrid` — the
 * same grid the editor draws on.
 */
import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@12-apps/ui/form/Button";
import { DropdownMenu, type DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";

import {
  setReportStatusAction,
  type DashboardBlockRender,
  type ReportStatusWire,
  type SavedReportView,
} from "./custom-reports-api";
import { ConfirmDialog } from "./lib/confirm-dialog";
import { exportRows } from "./lib/export-rows";
import { NO_PRINT_CLASS } from "./lib/print-export";
import { ReportBlockBody, ReportBlockFrame, ReportGrid, ReportGridItem } from "./report-grid";
import { exportColumnsFor } from "./report-render";
import { viewBlocks } from "./report-model";
import { useTransport } from "./transport-context";

/**
 * One block on the viewer's canvas: title, what it asks for, result, and its
 * own CSV export.
 *
 * A NAMED block shows its name with the spec sentence beneath — the two say
 * different things, and "Receita do mês" does not tell you it is filtered to
 * PIX. An UNNAMED block is titled by the sentence itself and shows no
 * subtitle, because repeating one string as both heading and caption is noise
 * rather than information.
 */
function ViewBlock({ block }: { block: DashboardBlockRender }): JSX.Element {
  const testId = `report-block-${block.id}`;
  const named = (block.title ?? "").trim() !== "";
  const sentence = block.sentence ?? "";
  const heading = named
    ? block.title!
    : sentence === ""
      ? ""
      : sentence.charAt(0).toLocaleUpperCase("pt-BR") + sentence.slice(1);
  return (
    <ReportGridItem span={block.span}>
      <ReportBlockFrame
        title={heading}
        description={named && sentence !== "" ? sentence : undefined}
        dataTestId={testId}
        actions={
          block.status === "ok" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportRows(
                  "csv",
                  block.render.rows,
                  exportColumnsFor(block.render),
                  `bloco-${block.id}`,
                )
              }
              data-testid={`${testId}-export`}
              className={NO_PRINT_CLASS}
            >
              CSV
            </Button>
          ) : null
        }
      >
        <ReportBlockBody block={block} dataTestId={testId} />
      </ReportBlockFrame>
    </ReportGridItem>
  );
}

/** The selected report's canvas. */
export function ReportViewCanvas({ view }: { view: SavedReportView }): JSX.Element {
  return (
    <ReportGrid dataTestId="report-grid">
      {viewBlocks(view).map((block) => (
        <ViewBlock key={block.id} block={block} />
      ))}
    </ReportGrid>
  );
}

/** Archive/restore copy, which differs enough to be worth a lookup. */
function archiveCopy(archived: boolean): {
  action: string;
  title: string;
  description: string;
} {
  if (archived) {
    return {
      action: "Restaurar",
      title: "Restaurar relatório?",
      description: "Ele volta para a lista de relatórios da loja.",
    };
  }
  return {
    action: "Arquivar",
    title: "Arquivar relatório?",
    description:
      "Ele sai da lista de relatórios, mas nada é perdido — você pode restaurá-lo depois em “Mostrar arquivados”.",
  };
}

/**
 * The ⋮ menu on the report's top right: edit, and archive (or restore, when
 * the open report is already archived). Both writes are OWNER/ADMIN-enforced
 * server-side; the menu only asks and calls.
 */
export function ReportActionsMenu({
  tenantSlug,
  view,
  onChanged,
}: {
  tenantSlug: string;
  view: SavedReportView;
  /** Told which lifecycle the report landed in, so the page can re-pick. */
  onChanged: (status: ReportStatusWire) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const transport = useTransport();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const archived = view.status === "archived";
  const copy = archiveCopy(archived);

  async function onConfirm(): Promise<void> {
    const next: ReportStatusWire = archived ? "published" : "archived";
    setBusy(true);
    const result = await setReportStatusAction(transport, tenantSlug, view, next);
    setBusy(false);
    setConfirming(false);
    if (result.ok) onChanged(next);
  }

  const items: DropdownMenuItem[] = [
    {
      id: "edit",
      label: "Editar",
      onClick: () => void navigate(`/${tenantSlug}/reports/${view.id}/edit`),
    },
    {
      id: "archive",
      label: copy.action,
      disabled: busy,
      onClick: () => setConfirming(true),
    },
  ];

  return (
    <>
      <DropdownMenu
        size="sm"
        items={items}
        trigger={
          // `outline`, not `text` (FUT-755): this sits on the tinted canvas
          // beside "Exportar PDF", and a transparent button there borrowed the
          // tint — 4.10:1 for its glyph against 4.47:1 for the outlined button
          // next to it. It is also the only route to Editar, so it should read
          // as a control rather than as a mark someone left on the page.
          <Button variant="outline" size="sm" aria-label="Ações do relatório" dataTestId="report-actions">
            ⋮
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        title={copy.title}
        description={copy.description}
        confirmText={copy.action}
        onConfirm={() => void onConfirm()}
        onCancel={() => setConfirming(false)}
        dataTestId="report-archive-confirm"
      />
    </>
  );
}
