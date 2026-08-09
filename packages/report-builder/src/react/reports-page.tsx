/**
 * The Relatórios area (FUT-391) — one page, one report at a time.
 *
 * The old hub was a wall of cards mixing three unrelated things: fixed built-in
 * reports, saved single reports and saved dashboards. Built-ins moved to the
 * lateral menu (they belong to the area they analyse — see `SYSTEM_REPORT_NAV`),
 * and what is left is what the tenant AUTHORED: a picker chooses one, the
 * canvas below shows it, and the ⋮ menu edits or archives it.
 */
import { useState, type JSX } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { SYSTEM_REPORT_KEYS } from "../server/presets";
import { useSavedReport, useSavedReports } from "./custom-reports-api";
import { NO_PRINT_CLASS, PRINT_REGION_ATTR, PrintExportButton, PrintStyles } from "./lib/print-export";
import { RangeToggle } from "./lib/range-toggle";
import { ReportCardList } from "./report-card-list";
import type { ReportScope } from "./report-list-filters";
import { selectReportOptions } from "./report-model";
import { ReportActionsMenu, ReportViewCanvas } from "./report-view";
import type { ReportRange } from "./reports-api";

/** Loading/error/canvas for the SELECTED report (the list already resolved). */
function SelectedReport({
  tenantSlug,
  reportId,
  range,
  onRangeChange,
  onChanged,
}: {
  tenantSlug: string;
  reportId: string;
  range: ReportRange;
  onRangeChange: (next: ReportRange) => void;
  onChanged: (id: string, status: string) => void;
}): JSX.Element {
  const query = useSavedReport(tenantSlug, reportId, range);

  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o relatório"
        message="Ele pode ter sido excluído, ou você não tem permissão."
        retryLabel="Tentar novamente"
        onRetry={() => {
          void query.refetch();
        }}
        dataTestId="page-reports-view-error"
      />
    );
  }
  if (!query.data) return <LoadingState dataTestId="page-reports-view-loading" />;

  const view = query.data;
  return (
    <Stack spacing={2} {...{ [PRINT_REGION_ATTR]: "" }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        className={NO_PRINT_CLASS}
      >
        <Text variant="heading" size="md" as="h2" data-testid="report-title">
          {view.name}
        </Text>
        {/*
          `gap: 1` is 8px. It read `gap: 8` (FUT-755), and MUI multiplies by the
          8px spacing unit, so the real gap was 64px against the `spacing={2}`
          (16px) its sibling Stack uses. That alone took this row to 455px
          inside a 390px column and pushed the ⋮ menu off-screen — and since ⋮
          is the only way to reach Editar, a report could not be edited on a
          phone at all. Wrapping keeps that true for any label length.
        */}
        <Box
          sx={{
            ml: "auto",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 1,
            minWidth: 0,
          }}
        >
          <RangeToggle value={range} onChange={onRangeChange} dataTestId="report-range" />
          <PrintExportButton title={view.name} dataTestId="report-export-pdf" />
          <ReportActionsMenu
            tenantSlug={tenantSlug}
            view={view}
            onChanged={(status) => onChanged(view.id, status)}
          />
        </Box>
      </Stack>
      {view.description ? (
        <Text variant="body" size="sm" color="secondary">
          {view.description}
        </Text>
      ) : null}
      <ReportViewCanvas view={view} />
    </Stack>
  );
}

/** Nothing authored yet (or nothing archived, when that filter is on). */
function NoReports({ showArchived, onCreate }: { showArchived: boolean; onCreate: () => void }): JSX.Element {
  return (
    <EmptyState
      variant="minimal"
      title={showArchived ? "Nenhum relatório arquivado" : "Nenhum relatório ainda"}
      description={
        showArchived
          ? "Relatórios arquivados aparecem aqui — nada foi arquivado nesta loja."
          : "Um relatório é um painel: monte-o com blocos de gráficos, tabelas e indicadores."
      }
      dataTestId="reports-empty"
      {...(showArchived ? {} : { primaryAction: { label: "Criar relatório", onClick: onCreate } })}
    />
  );
}

/** The area's title and one-line explanation of what a report is now. */
function ReportsHeading(): JSX.Element {
  return (
    <Stack spacing={0.5} className={NO_PRINT_CLASS}>
      <Text variant="heading" size="lg" as="h1">
        Relatórios
      </Text>
      <Text variant="body" size="sm" color="secondary">
        Seus painéis: escolha um para ver, ou monte outro com os blocos que quiser.
      </Text>
    </Stack>
  );
}

export function ReportsPage({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<ReportRange>("30d");
  const [scope, setScope] = useState<ReportScope>("active");
  const [search, setSearch] = useState("");
  const query = useSavedReports(tenantSlug);
  const { selectedId } = selectReportOptions(
    query.data?.reports ?? [],
    scope === "archived",
    reportId,
  );

  const goTo = (id: string): void => {
    void navigate(id === "" ? `/${tenantSlug}/reports` : `/${tenantSlug}/reports/${id}`);
  };

  // A pre-FUT-391 deep link to a built-in report (`/reports/<key>`): built-ins
  // now live under `/reports/system/<key>`, reached from the lateral menu.
  if (reportId !== undefined && SYSTEM_REPORT_KEYS.includes(reportId)) {
    return <Navigate to={`/${tenantSlug}/reports/system/${reportId}`} replace />;
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os relatórios"
        message="Tente novamente em instantes."
        retryLabel="Tentar novamente"
        onRetry={() => {
          void query.refetch();
        }}
        dataTestId="page-reports-error"
      />
    );
  }
  if (!query.data) return <LoadingState dataTestId="page-reports-loading" />;

  const onCreate = (): void => void navigate(`/${tenantSlug}/reports/new`);
  return (
    <Stack spacing={3} data-testid="page-reports">
      <PrintStyles />
      <ReportsHeading />
      <Box className={NO_PRINT_CLASS}>
        <ReportCardList
          reports={query.data.reports}
          selectedId={selectedId}
          scope={scope}
          search={search}
          onScopeChange={(next) => {
            setScope(next);
            // The current selection may not survive the scope change; land on
            // the area root and let the list resolve the new first entry.
            goTo("");
          }}
          onSearchChange={setSearch}
          onSelect={goTo}
          onCreate={onCreate}
        />
      </Box>
      {selectedId === "" ? (
        <NoReports showArchived={scope === "archived"} onCreate={onCreate} />
      ) : (
        <SelectedReport
          tenantSlug={tenantSlug}
          reportId={selectedId}
          range={range}
          onRangeChange={setRange}
          onChanged={(id, status) => {
            void queryClient.invalidateQueries({ queryKey: ["admin", tenantSlug, "reports"] });
            // Archiving takes the report out of the picker; restoring keeps it.
            goTo(status === "archived" ? "" : id);
          }}
        />
      )}
    </Stack>
  );
}
