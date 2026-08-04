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
import { Button } from "@12-apps/ui/form/Button";
import { Checkbox } from "@12-apps/ui/form/Checkbox";
import { Select } from "@12-apps/ui/form/Select";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { SYSTEM_REPORT_KEYS } from "../server/presets";
import { useSavedReport, useSavedReports, type SavedReportSummary } from "./custom-reports-api";
import { NO_PRINT_CLASS, PRINT_REGION_ATTR, PrintExportButton, PrintStyles } from "./lib/print-export";
import { RangeToggle } from "./lib/range-toggle";
import { selectReportOptions } from "./report-model";
import { ReportActionsMenu, ReportViewCanvas } from "./report-view";
import type { ReportRange } from "./reports-api";

/** Picker label: archived reports say so, since they are hidden by default. */
function optionLabel(report: SavedReportSummary): string {
  if (report.status === "archived") return `${report.name} (arquivado)`;
  if (report.status === "draft") return `${report.name} (rascunho)`;
  return report.name;
}

/** The report picker + "novo relatório", the page's primary controls. */
function ReportPicker({
  options,
  selectedId,
  showArchived,
  onSelect,
  onToggleArchived,
  onCreate,
}: {
  options: SavedReportSummary[];
  selectedId: string;
  showArchived: boolean;
  onSelect: (id: string) => void;
  onToggleArchived: (next: boolean) => void;
  onCreate: () => void;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
      <Box sx={{ minWidth: 260 }}>
        <Select
          size="small"
          aria-label="Relatório"
          options={options.map((report) => ({ value: report.id, label: optionLabel(report) }))}
          value={selectedId}
          onChange={(event) => onSelect(event.target.value as string)}
          data-testid="reports-picker"
        />
      </Box>
      <Button variant="solid" size="sm" onClick={onCreate} data-testid="reports-new">
        Novo relatório
      </Button>
      <Checkbox
        label="Mostrar arquivados"
        checked={showArchived}
        onChange={(_event, checked) => onToggleArchived(checked)}
        data-testid="reports-show-archived"
      />
    </Stack>
  );
}

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
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 8 }}>
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
  const [showArchived, setShowArchived] = useState(false);
  const query = useSavedReports(tenantSlug);
  const { options, selectedId } = selectReportOptions(
    query.data?.reports ?? [],
    showArchived,
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
        <ReportPicker
          options={options}
          selectedId={selectedId}
          showArchived={showArchived}
          onSelect={goTo}
          onToggleArchived={(next) => {
            setShowArchived(next);
            // The current selection may not survive the filter change; land on
            // the area root and let the picker resolve the new first option.
            goTo("");
          }}
          onCreate={onCreate}
        />
      </Box>
      {selectedId === "" ? (
        <NoReports showArchived={showArchived} onCreate={onCreate} />
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
