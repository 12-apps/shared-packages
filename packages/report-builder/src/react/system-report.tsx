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

import { SYSTEM_REPORT_NAV } from "../server/presets";
import { BlockToolCluster, useBlockTableView } from "./lib/block-tools";
import { exportRows } from "./lib/export-rows";
import { PRINT_REGION_ATTR, PrintStyles } from "./lib/print-export";
import { ReportControls, ReportPageHeader, sectionBackTarget } from "./lib/report-chrome";
import { exportColumnsFor, ReportRenderView } from "./report-render";
import { useSystemReport, type ReportGrain, type ReportRange } from "./reports-api";

export function SystemReportPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { reportKey = "" } = useParams();
  const [range, setRange] = useState<ReportRange>("30d");
  const [grain, setGrain] = useState<ReportGrain>("day");
  const query = useSystemReport(tenantSlug, reportKey, range, grain);
  // Before the early returns below, so the hook order cannot depend on whether
  // the run has resolved. `undefined` simply means "no tools yet".
  const tableView = useBlockTableView(query.data?.render);

  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o relatório"
        message="Verifique sua permissão ou tente novamente em instantes."
        retryLabel="Tentar novamente"
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
  const section = SYSTEM_REPORT_NAV.find((entry) => entry.key === reportKey)?.section;
  return (
    <Stack spacing={3} data-testid="page-system-report" {...{ [PRINT_REGION_ATTR]: "" }}>
      <PrintStyles />
      <ReportPageHeader
        back={sectionBackTarget(tenantSlug, section)}
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
        printTitle={report.title}
        onExport={() =>
          exportRows(
            "csv",
            report.render.rows,
            exportColumnsFor(report.render),
            `relatorio-${report.key}`,
          )
        }
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
        <ReportRenderView render={report.render} asTable={tableView.asTable} />
      </Stack>
    </Stack>
  );
}
