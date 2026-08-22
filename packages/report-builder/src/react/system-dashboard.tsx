/**
 * Built-in SECTION dashboard: every built-in report of one admin area on a
 * single canvas, under a single period.
 *
 * The Pedidos menu used to carry five sibling rows — resumo, por produto, por
 * categoria, formas de pagamento, por horário. They are not five questions;
 * they are five angles on "how did we sell?", and read one page at a time they
 * could not be compared, because each screen carried its own period selector.
 * Here one selector governs the whole canvas.
 *
 * Nothing new runs the reports: each block is the SAME `useSystemReport` call
 * the single-report page makes, so every block stays server-authorized and
 * tenant-scoped exactly as before, and a preset fixed upstream is fixed here.
 * Blocks land on the shared `ReportGrid` the authored dashboards draw on, and
 * each resolves independently — a slow ranking never holds up the revenue
 * chart, and one block failing leaves the other four readable.
 */
import { useState, type JSX } from "react";
import { useParams } from "react-router-dom";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Stack } from "@12-apps/ui/mui/Stack";

import { findSystemDashboard } from "../server/system-reports";
import { BlockToolCluster, useBlockTableView } from "./lib/block-tools";
import { PRINT_REGION_ATTR, PrintStyles } from "./lib/print-export";
import { ReportControls, ReportPageHeader, sectionBackTarget } from "./lib/report-chrome";
import { ReportBlockFrame, ReportGrid, ReportGridItem } from "./report-grid";
import { ReportRenderView } from "./report-render";
import { widenAction } from "./lib/widen-range";
import { useSystemReport, type ReportGrain, type ReportRange } from "./reports-api";
import { useReportCopy, useReportSurface } from "./transport-context";

interface BlockProps {
  tenantSlug: string;
  reportKey: string;
  span: number;
  range: ReportRange;
  grain: ReportGrain;
  /** Widens the WHOLE canvas — an empty block's offer moves every block. */
  onRangeChange: (range: ReportRange) => void;
}

/**
 * One block: its own report run, framed by the shared block card.
 *
 * A component per block rather than one N-report query, because that is what
 * makes each block independent — its own loading state, its own error, its own
 * cache entry keyed by (report, range, grain), so switching the period re-uses
 * whatever the canvas already fetched.
 *
 * CSV export is per block, not per page: the blocks are different shapes (a
 * time series, a donut, two rankings), so one merged file would have no honest
 * set of columns.
 */
function DashboardBlock({
  tenantSlug,
  reportKey,
  span,
  range,
  grain,
  onRangeChange,
}: BlockProps): JSX.Element {
  const copy = useReportCopy().screens.system;
  const ranges = useReportCopy().screens.ranges;
  const query = useSystemReport(tenantSlug, reportKey, range, grain);
  const testId = `system-dashboard-block-${reportKey}`;
  // The catalog title, so the frame is labelled while the run is still in
  // flight — a canvas of anonymous spinners says nothing about what is coming.
  const navEntry = useReportSurface().systemReports.find((entry) => entry.key === reportKey);
  const title = navEntry?.title ?? reportKey;
  const report = query.data;
  const tableView = useBlockTableView(report?.render);

  return (
    <ReportGridItem span={span}>
      <ReportBlockFrame
        title={title}
        // The preset's own statement of what its figures exclude and when they
        // are withheld — from the catalog, so it is present before the run
        // resolves and cannot drift from the report it describes. PROSE: it
        // wraps in full, and is never truncated the way the authored canvas's
        // generated sentence is (FUT-755).
        description={navEntry?.description}
        dataTestId={testId}
        actions={
          <BlockToolCluster
            view={tableView}
            renderTestId={`${testId}-render`}
            menuTestId={`${testId}-menu`}
            csv={
              report
                ? { filename: `relatorio-${report.key}`, dataTestId: `${testId}-export` }
                : undefined
            }
          />
        }
      >
        {query.isError ? (
          <Alert severity="error" data-testid={`${testId}-error`}>
            {copy.blockFailed}
          </Alert>
        ) : report ? (
          <ReportRenderView
            render={report.render}
            dataTestId={`${testId}-render`}
            onWidenRange={widenAction(range, onRangeChange, ranges)}
            asTable={tableView.asTable}
          />
        ) : (
          <LoadingState dataTestId={`${testId}-loading`} />
        )}
      </ReportBlockFrame>
    </ReportGridItem>
  );
}

export function SystemDashboardPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const copy = useReportCopy().screens.system;
  const builderCopy = useReportCopy().screens.builder;
  const { dashboardKey = "" } = useParams();
  const [range, setRange] = useState<ReportRange>("30d");
  const [grain, setGrain] = useState<ReportGrain>("day");
  const surface = useReportSurface();
  const dashboard = findSystemDashboard(surface.systemDashboards, dashboardKey);

  if (!dashboard) {
    return (
      <ErrorState
        title={copy.dashboardMissingTitle}
        message={copy.dashboardMissingBody}
        dataTestId="page-system-dashboard-error"
      />
    );
  }

  // The toggle applies when ANY block buckets by date: it then moves those
  // blocks and leaves the rest untouched.
  const supportsGrain = dashboard.blocks.some(
    (block) =>
      surface.systemReports.find((entry) => entry.key === block.reportKey)?.supportsGrain ?? false,
  );

  return (
    <Stack spacing={3} data-testid="page-system-dashboard" {...{ [PRINT_REGION_ATTR]: "" }}>
      <PrintStyles />
      <ReportPageHeader
        back={sectionBackTarget(tenantSlug, surface.sections, dashboard.section, builderCopy)}
        title={dashboard.title}
        description={dashboard.description}
        titleTestId="system-dashboard-title"
        backTestId="system-dashboard-back"
      />

      <ReportControls
        range={range}
        onRangeChange={setRange}
        grain={grain}
        onGrainChange={setGrain}
        showGrain={supportsGrain}
        printTitle={dashboard.title}
      />

      {/* Canvas-level disclosures, above the numbers they qualify (FUT-454).
       * `severity="info"` rather than a muted caption: what is excluded from
       * the data and when a figure is withheld are not footnotes — a reader
       * who misses them reads every number on the page wrongly. */}
      {(dashboard.notes ?? []).map((note, index) => (
        <Alert key={note} severity="info" data-testid={`system-dashboard-note-${index}`}>
          {note}
        </Alert>
      ))}

      <ReportGrid dataTestId="system-dashboard-grid">
        {dashboard.blocks.map((block) => (
          <DashboardBlock
            key={block.reportKey}
            tenantSlug={tenantSlug}
            reportKey={block.reportKey}
            span={block.span}
            range={range}
            grain={grain}
            onRangeChange={setRange}
          />
        ))}
      </ReportGrid>
    </Stack>
  );
}
