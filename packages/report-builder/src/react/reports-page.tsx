/**
 * The Relatórios area (FUT-391) — TWO screens, on the two URLs it already had.
 *
 * The old hub was a wall of cards mixing three unrelated things: fixed built-in
 * reports, saved single reports and saved dashboards. Built-ins moved to the
 * lateral menu (they belong to the area they analyse — see `SYSTEM_REPORT_NAV`),
 * and what is left is what the tenant AUTHORED.
 *
 * What replaced it was still one screen: the picker on top, the selected report
 * underneath. Two problems came from that, and both are the same problem. A
 * picker must always have something picked, so the area auto-selected the first
 * report — meaning **there was no state in which you were looking at the
 * list**; and "open a report" meant "scroll down", so the report never had a
 * page of its own to be titled, dated or linked to.
 *
 * So `/reports` is the grid and nothing else, and `/reports/:id` is the report
 * and nothing else (FUT-755). The routes are unchanged, so every existing deep
 * link still opens what it always did.
 */
import { useState, type JSX } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { SYSTEM_REPORT_KEYS } from "../server/presets";
import { useSavedReports, type SavedReportSummary } from "./custom-reports-api";
import { NO_PRINT_CLASS, PrintStyles } from "./lib/print-export";
import { PAGE_TITLE_SX, useReportSurfaceSx } from "./lib/report-surface";
import { ReportCardList } from "./report-card-list";
import { ArchiveFromListDialog } from "./report-list-archive";
import type { ReportScope } from "./report-list-filters";
import { ReportScreen } from "./report-screen";
import type { ReportRange } from "./reports-api";

/** What a report opens on when it stores no "Período padrão ao abrir". */
const FALLBACK_RANGE: ReportRange = "30d";

/**
 * A saved report's stored opening period, read STRUCTURALLY.
 *
 * The setting itself — the field on the wire type, its persistence and the
 * dialog that writes it — lands alongside this. Reading it through a local
 * shape rather than off `SavedReportSummary` lets the two halves land in
 * either order: the property is optional here, so this compiles both before
 * the field exists and after, and `?? FALLBACK_RANGE` is the same answer in
 * both cases. `Pick<…, 'id'>` keeps it a real object type — a shape whose
 * every property is optional matches nothing under TypeScript's weak-type
 * rule, so the id is load-bearing, not decoration.
 */
type ReportOpeningRange = Pick<SavedReportSummary, "id"> & {
  // `| null` as well as optional: the column is nullable, so "no preference"
  // reaches the client as an explicit null on a report that once had one.
  defaultRange?: ReportRange | null;
};

function openingRange(reports: readonly ReportOpeningRange[], selectedId: string): ReportRange {
  return reports.find((report) => report.id === selectedId)?.defaultRange ?? FALLBACK_RANGE;
}

/**
 * The period the viewer runs on, and the way to change it.
 *
 * DERIVED from which report is open, not stored as a bare `useState`. A report
 * opens on its own "Período padrão ao abrir", and a `useState` initialiser runs
 * on mount and never again — seeded there it is also wrong the moment the
 * listing arrives, because on a cold deep link the summary carrying the
 * default is still in flight when the component mounts. What IS state is the
 * period an operator picked by hand, stored against the report they picked it
 * on: their choice wins while they are reading that report, and the next report
 * opens on its own default. That is the difference between a default and a
 * lock.
 */
function useSelectedRange(
  reports: readonly ReportOpeningRange[],
  selectedId: string,
): { range: ReportRange; onRangeChange: (next: ReportRange) => void } {
  const [picked, setPicked] = useState<{ reportId: string; range: ReportRange } | null>(null);
  return {
    range:
      picked !== null && picked.reportId === selectedId
        ? picked.range
        : openingRange(reports, selectedId),
    onRangeChange: (next) => setPicked({ reportId: selectedId, range: next }),
  };
}

/** The list itself could not be read — a whole-page state, not an empty grid. */
function ReportsLoadError({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <ErrorState
      title="Não foi possível carregar os relatórios"
      message="Tente novamente em instantes."
      retryLabel="Tentar novamente"
      onRetry={onRetry}
      dataTestId="page-reports-error"
    />
  );
}

/** The area's title and one-line explanation of what a report is now. */
function ReportsHeading(): JSX.Element {
  return (
    <Stack spacing={0.5} className={NO_PRINT_CLASS}>
      <Box component="h1" sx={PAGE_TITLE_SX}>
        Relatórios
      </Box>
      <Text variant="body" size="sm" color="secondary">
        Seus painéis: escolha um para ver, ou monte outro com os blocos que quiser.
      </Text>
    </Stack>
  );
}

/** `/:tenantSlug/reports` — the grid, and only the grid. */
function ReportsListScreen({
  tenantSlug,
  reports,
}: {
  tenantSlug: string;
  reports: readonly SavedReportSummary[];
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ReportScope>("active");
  const [search, setSearch] = useState("");
  // The report the ⋮ menu asked to file, doubling as the dialog's open flag:
  // two values could disagree about WHICH report is being archived.
  const [filing, setFiling] = useState<SavedReportSummary | null>(null);

  return (
    <>
      <ReportsHeading />
      <Box className={NO_PRINT_CLASS}>
        <ReportCardList
          reports={reports}
          scope={scope}
          search={search}
          // Scope and search narrow the GRID, and the grid is all that is on
          // this screen — so neither has a selection to drop any more.
          onScopeChange={setScope}
          onSearchChange={setSearch}
          onSelect={(id) => void navigate(`/${tenantSlug}/reports/${id}`)}
          onEdit={(id) => void navigate(`/${tenantSlug}/reports/${id}/edit`)}
          onArchive={setFiling}
          onCreate={() => void navigate(`/${tenantSlug}/reports/new`)}
        />
      </Box>
      <ArchiveFromListDialog
        tenantSlug={tenantSlug}
        report={filing}
        onClose={() => setFiling(null)}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
        }}
      />
    </>
  );
}

/** `/:tenantSlug/reports/:reportId` — the report, and its way back to the grid. */
function OpenReportScreen({
  tenantSlug,
  reports,
  reportId,
  range,
  onRangeChange,
}: {
  tenantSlug: string;
  reports: readonly SavedReportSummary[];
  reportId: string;
  range: ReportRange;
  onRangeChange: (next: ReportRange) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toList = (): void => void navigate(`/${tenantSlug}/reports`);
  return (
    <ReportScreen
      tenantSlug={tenantSlug}
      reportId={reportId}
      range={range}
      // The run payload has no document timestamp — only the window's — so the
      // header's "editado há 2 min" comes from the listing the page already holds.
      updatedAt={reports.find((report) => report.id === reportId)?.updatedAt ?? ""}
      now={new Date()}
      onRangeChange={onRangeChange}
      onBack={toList}
      onEdit={() => void navigate(`/${tenantSlug}/reports/${reportId}/edit`)}
      onChanged={(status) => {
        void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
        // Archiving takes the report out of the scope you came from, so
        // staying on it is a dead end — go back to the list. Restoring leaves
        // you where you already are, reading it.
        if (status === "archived") toList();
      }}
    />
  );
}

export function ReportsPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { reportId } = useParams();
  const query = useSavedReports(tenantSlug);
  // Above the early returns — a hook cannot sit behind a conditional.
  const surfaceSx = useReportSurfaceSx();
  const reports = query.data?.reports ?? [];
  // No auto-selection any more (FUT-755). Choosing IS navigating now, so a
  // default pick would make `/reports` bounce straight into the first report
  // and put the list permanently out of reach.
  const openId = reportId ?? "";
  const { range, onRangeChange } = useSelectedRange(reports, openId);

  // A pre-FUT-391 deep link to a built-in report (`/reports/<key>`): built-ins
  // now live under `/reports/system/<key>`, reached from the lateral menu.
  if (reportId !== undefined && SYSTEM_REPORT_KEYS.includes(reportId)) {
    return <Navigate to={`/${tenantSlug}/reports/system/${reportId}`} replace />;
  }
  if (query.isError) {
    return (
      <ReportsLoadError
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (!query.data) return <LoadingState dataTestId="page-reports-loading" />;

  return (
    <Stack spacing={3} sx={surfaceSx} data-testid="page-reports">
      <PrintStyles />
      {openId === "" ? (
        <ReportsListScreen tenantSlug={tenantSlug} reports={reports} />
      ) : (
        <OpenReportScreen
          tenantSlug={tenantSlug}
          reports={reports}
          reportId={openId}
          range={range}
          onRangeChange={onRangeChange}
        />
      )}
    </Stack>
  );
}
