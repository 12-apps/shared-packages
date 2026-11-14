/**
 * Built-in report viewer (FUT-133): ONE system report with the shared chrome
 * — period presets, the date-grain toggle when the report supports it, and
 * CSV/JSON export of exactly the rows on screen. Rendering flows through the
 * serializable render model (SpecChart or Table).
 *
 * Built-ins are reached from the lateral menu, nested under the area they
 * analyse (FUT-391) — so "back" returns to that AREA, not to the Relatórios
 * page, which no longer lists them.
 *
 * A whole SECTION's built-ins on one canvas is {@link SystemDashboardPage}
 * next door; this page stays the single-report deep link that dashboard's
 * blocks were composed from, and the two share their chrome.
 */
import { useState, type JSX } from "react";
import { useParams } from "react-router-dom";

import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Stack } from "@12-apps/ui/mui/Stack";

import { BlockToolCluster, useBlockTableView } from "./lib/block-tools";
import { exportRows } from "./lib/export-rows";
import { PRINT_REGION_ATTR, PrintStyles } from "./lib/print-export";
import { initialRange, ReportControls, ReportPageHeader, sectionBackTarget } from "./lib/report-chrome";
import { noteCsvLines } from "./lib/report-notes";
import { ReportBodyWithNotes } from "./report-notes";
import { exportColumnsFor } from "./report-render";
import { useSystemReport, type ReportGrain, type ReportNoteView, type ReportRange } from "./reports-api";
import { useReportCopy, useReportEngineCopy, useReportSurface } from "./transport-context";

/** The page's CSV: exactly the rows on screen, in the columns on screen. */
function exportReportCsv(
  report: { key: string; render: Parameters<typeof exportColumnsFor>[0]; notes?: ReportNoteView[] },
  values: Parameters<typeof exportColumnsFor>[1],
  notes: string[],
): void {
  exportRows("csv", report.render.rows, exportColumnsFor(report.render, values), `relatorio-${report.key}`, notes);
}

export function SystemReportPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { system: systemCopy, builder: builderCopy } = useReportCopy().screens;
  const { reportKey = "" } = useParams();
  const entry = useReportSurface().systemReports.find((candidate) => candidate.key === reportKey);
  const [range, setRange] = useState<ReportRange>(() => initialRange(entry?.ranges));
  const [grain, setGrain] = useState<ReportGrain>("day");
  const query = useSystemReport(tenantSlug, reportKey, range, grain);
  // Before the early returns below, so the hook order cannot depend on whether
  // the run has resolved. `undefined` simply means "no tools yet".
  const tableView = useBlockTableView(query.data?.render);
  const surface = useReportSurface();
  const copy = useReportEngineCopy();

  if (query.isError) {
    return (
      <ErrorState
        title={systemCopy.reportFailedTitle}
        message={systemCopy.reportFailedBody}
        retryLabel={systemCopy.retry}
        onRetry={() => {
          void query.refetch();
        }}
        dataTestId="page-system-report-error"
      />
    );
  }
  if (!query.data) {
    return <LoadingState dataTestId="page-system-report-loading" />;
  }

  const report = query.data;
  const section = entry?.section;
  return (
    <Stack spacing={3} data-testid="page-system-report" {...{ [PRINT_REGION_ATTR]: "" }}>
      <PrintStyles />
      <ReportPageHeader
        back={sectionBackTarget(tenantSlug, surface.sections, section, builderCopy)}
        title={report.title}
        description={report.description}
        titleTestId="system-report-title"
        backTestId="system-report-back"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        grain={grain}
        onGrainChange={setGrain}
        showGrain={report.supportsGrain}
        grains={report.grains}
        grainLabel={entry?.grainLabel}
        ranges={entry?.ranges}
        printTitle={report.title}
        onExport={() => exportReportCsv(report, copy.values, noteCsvLines(report.notes, systemCopy))}
      />

      {/* The same toggle every block on a canvas gets — one implementation, so
        * a chart's table fallback is reached identically wherever it is read.
        * This page has no block card to hover, so the cluster is simply always
        * visible here; the CSV stays in the controls row above, where this
        * page has always exported from. */}
      <Stack spacing={1}>
        {tableView.canToggle ? (
          <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
            <BlockToolCluster
              view={tableView}
              renderTestId="report-render"
              menuTestId="report-render-menu"
            />
          </Stack>
        ) : null}
        <ReportBodyWithNotes report={report} title={report.title} tenantSlug={tenantSlug} asTable={tableView.asTable} />
      </Stack>
    </Stack>
  );
}
