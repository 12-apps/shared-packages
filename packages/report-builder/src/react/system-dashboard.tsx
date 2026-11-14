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
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";

import {
  findSystemDashboard,
  type SystemDashboardBlockDef,
  type SystemDashboardDef,
  type SystemReportNavEntry,
} from "../server/system-reports";
import { BlockToolCluster, useBlockTableView } from "./lib/block-tools";
import { BlockExpandDialog } from "./lib/block-expand-dialog";
import { PRINT_REGION_ATTR, PrintStyles } from "./lib/print-export";
import {
  initialGrain,
  initialRange,
  ReportControls,
  ReportPageHeader,
  sectionBackTarget,
} from "./lib/report-chrome";
import { ReportBlockFrame, ReportGrid, ReportGridItem } from "./report-grid";
import { NotesBelowCard, ReportBodyWithNotes } from "./report-notes";
import { ReportRenderView } from "./report-render";
import { widenAction } from "./lib/widen-range";
import {
  REPORT_GRAINS,
  useSystemReport,
  type ReportGrain,
  type ReportNoteView,
  type ReportRange,
  type ReportRender,
} from "./reports-api";
import { useReportCopy, useReportSurface } from "./transport-context";

interface BlockProps {
  tenantSlug: string;
  reportKey: string;
  span: number;
  range: ReportRange;
  grain: ReportGrain;
  /** Widens the WHOLE canvas — an empty block's offer moves every block. */
  onRangeChange: (range: ReportRange) => void;
  /** The periods the canvas offers: the empty state never offers another (FUT-4063). */
  offered?: readonly ReportRange[];
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
  offered,
}: BlockProps): JSX.Element {
  const { system: copy, ranges } = useReportCopy().screens;
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
            csv={blockCsv(report, testId)}
            expandable
          />
        }
      >
        {query.isError ? (
          <Alert severity="error" data-testid={`${testId}-error`}>
            {copy.blockFailed}
          </Alert>
        ) : report ? (
          <ReportBodyWithNotes
            report={report}
            title={title}
            tenantSlug={tenantSlug}
            dataTestId={`${testId}-render`}
            onWidenRange={widenAction(range, onRangeChange, ranges, offered)}
            asTable={tableView.asTable}
            bounded
          />
        ) : (
          <LoadingState dataTestId={`${testId}-loading`} />
        )}
      </ReportBlockFrame>
      <NotesBelowCard notes={report?.notes} tenantSlug={tenantSlug} dataTestId={testId} />
      {report ? (
        <ExpandedBlock report={report} view={tableView} title={title} description={navEntry?.description} testId={testId} />
      ) : null}
    </ReportGridItem>
  );
}

/** A block's CSV tool, once its run has landed: its rows, then its notes. */
function blockCsv(
  report: { key: string; notes?: ReportNoteView[] } | undefined,
  testId: string,
): { filename: string; dataTestId: string; notes?: ReportNoteView[] } | undefined {
  if (!report) return undefined;
  return { filename: `relatorio-${report.key}`, dataTestId: `${testId}-export`, notes: report.notes };
}

/** A bounded block's table, whole, in a dialog — the block's "expand" tool. */
function ExpandedBlock({
  report,
  view,
  title,
  description,
  testId,
}: {
  report: { render: ReportRender; notes?: ReportNoteView[] };
  view: ReturnType<typeof useBlockTableView>;
  title: string;
  description?: string;
  testId: string;
}): JSX.Element {
  return (
    <BlockExpandDialog
      open={view.expanded}
      onClose={() => view.setExpanded(false)}
      title={title}
      description={description}
      dataTestId={`${testId}-expanded`}
    >
      <ReportRenderView
        render={report.render}
        dataTestId={`${testId}-expanded-render`}
        asTable={view.asTable}
        notes={report.notes}
        caption={title}
      />
    </BlockExpandDialog>
  );
}

/**
 * The grain toggle a canvas offers: it applies when ANY block buckets by date,
 * and offers what ANY such block can draw (FUT-4063) — the union, in the
 * canonical order. A block that names no grains offers all three.
 */
function dashboardGrains(
  dashboard: SystemDashboardDef | undefined,
  reports: readonly SystemReportNavEntry[],
): { supportsGrain: boolean; grains: ReportGrain[] } {
  const grained = (dashboard?.blocks ?? [])
    .map((block) => reports.find((entry) => entry.key === block.reportKey))
    .filter((entry) => entry?.supportsGrain === true);
  const grains = REPORT_GRAINS.filter((grain) =>
    grained.some((entry) => (entry?.grains ?? REPORT_GRAINS).includes(grain)),
  );
  return { supportsGrain: grained.length > 0, grains };
}

/**
 * A block drawn bare (`frame: false`, FUT-4063): its rendering straight on the
 * canvas, no titled card and no tools — the KPI row the prototype draws as
 * four cards of their own.
 */
function BareBlock({
  tenantSlug,
  block,
  range,
  grain,
}: {
  tenantSlug: string;
  block: SystemDashboardBlockDef;
  range: ReportRange;
  grain: ReportGrain;
}): JSX.Element {
  const { system: copy } = useReportCopy().screens;
  const query = useSystemReport(tenantSlug, block.reportKey, range, grain);
  const testId = `system-dashboard-block-${block.reportKey}`;
  const title = useReportSurface().systemReports.find((entry) => entry.key === block.reportKey)?.title;
  return (
    <ReportGridItem span={block.span}>
      <Box data-testid={testId}>
        {query.isError ? (
          <Alert severity="error" data-testid={`${testId}-error`}>
            {copy.blockFailed}
          </Alert>
        ) : query.data ? (
          <ReportBodyWithNotes report={query.data} title={title ?? block.reportKey} tenantSlug={tenantSlug} dataTestId={`${testId}-render`} />
        ) : (
          <LoadingState dataTestId={`${testId}-loading`} />
        )}
      </Box>
      {/* As on a framed block: on a phone, a note that sits below the card
        * sits below this bare rendering, never nowhere (FUT-4063). */}
      <NotesBelowCard notes={query.data?.notes} tenantSlug={tenantSlug} dataTestId={testId} />
    </ReportGridItem>
  );
}

export function SystemDashboardPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { system: copy, builder: builderCopy } = useReportCopy().screens;
  const { dashboardKey = "" } = useParams();
  const surface = useReportSurface();
  const dashboard = findSystemDashboard(surface.systemDashboards, dashboardKey);
  const { supportsGrain, grains } = dashboardGrains(dashboard, surface.systemReports);
  const [range, setRange] = useState<ReportRange>(() => initialRange(dashboard?.ranges));
  const [grain, setGrain] = useState<ReportGrain>(() => initialGrain(grains));

  if (!dashboard) {
    return (
      <ErrorState
        title={copy.dashboardMissingTitle}
        message={copy.dashboardMissingBody}
        dataTestId="page-system-dashboard-error"
      />
    );
  }

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
        grains={grains}
        grainLabel={dashboard.grainLabel}
        ranges={dashboard.ranges}
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
        {dashboard.blocks.map((block) =>
          block.frame === false ? (
            <BareBlock key={block.reportKey} tenantSlug={tenantSlug} block={block} range={range} grain={grain} />
          ) : (
            <DashboardBlock
              key={block.reportKey}
              tenantSlug={tenantSlug}
              reportKey={block.reportKey}
              span={block.span}
              range={range}
              grain={grain}
              onRangeChange={setRange}
              offered={dashboard.ranges}
            />
          ),
        )}
      </ReportGrid>
    </Stack>
  );
}
