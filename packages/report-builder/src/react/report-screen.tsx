/**
 * A saved report on its OWN page (FUT-755) — `prototype.html`'s view screen.
 *
 * The area used to be one screen: the picker at the top and, underneath it,
 * whatever report happened to be selected. That made "open a report" mean
 * "scroll", and it made the list impossible to reach with nothing selected —
 * the picker auto-chose the first report, so there was no state in which you
 * were looking at the LIST.
 *
 * Two screens instead, on the two URLs that already existed: `/reports` is the
 * grid, `/reports/:id` is the report. This module is the second one — the
 * header the prototype puts above the blocks (back, name, what it is, and the
 * three things you can do to it), the period row, and the canvas.
 */
import type { JSX } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { useTheme } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import { useSavedReport, type SavedReportView } from "./custom-reports-api";
import { PencilIcon } from "./lib/block-icons";
import { NO_PRINT_CLASS, PRINT_REGION_ATTR, PrintExportButton } from "./lib/print-export";
import { RangeToggle } from "./lib/range-toggle";
import { CONTROL_ROW_SX, PAGE_TITLE_SX, stateChipSx } from "./lib/report-surface";
import { relativeReportTime, visibilityLabel } from "./report-list-filters";
import { ReportActionsMenu, ReportViewCanvas } from "./report-view";
import type { ReportRange } from "./reports-api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  archived: "Arquivado",
  published: "Publicado",
};

/**
 * The lifecycle badge beside the name. Unlike the card's, this one ALWAYS shows
 * — a report you have opened is one whose state you are about to act on, and
 * "Publicado" is the fact that makes Arquivar the sensible next move.
 */
function StatusChip({ status }: { status: SavedReportView["status"] }): JSX.Element {
  const theme = useTheme();
  const tone =
    status === "draft"
      ? theme.palette.warning.main
      : status === "archived"
        ? theme.palette.text.secondary
        : theme.palette.primary.main;
  return (
    <Box
      sx={{
        display: "inline-flex",
        "& .MuiChip-root": stateChipSx(tone, theme.palette.background.paper),
      }}
    >
      <Chip label={STATUS_LABELS[status] ?? status} size="sm" variant="filled" />
    </Box>
  );
}

const DAY_MS = 86_400_000;

/**
 * The tenant's UTC offset, inferred from a window boundary.
 *
 * The payload carries instants, not a zone — but `from` is by construction the
 * tenant's LOCAL MIDNIGHT, so how far it sits from a UTC midnight IS the
 * offset. Without this the label is rendered in whichever zone the reader's
 * laptop happens to be in, and a window ending at local midnight lands a day
 * late (or early) for everyone outside the store's own zone.
 *
 * Anything past twelve hours is the other side of the dateline: a boundary
 * 22 hours after UTC midnight is a zone 2 hours AHEAD, not 22 behind.
 */
function tenantOffsetMs(fromMs: number): number {
  const rem = ((fromMs % DAY_MS) + DAY_MS) % DAY_MS;
  return rem <= DAY_MS / 2 ? -rem : DAY_MS - rem;
}

/**
 * The window the server actually resolved, as "07/07 – 06/08".
 *
 * The preset says "30 dias"; this says WHICH thirty, and that is the only
 * version of the period a number can be checked against. `toExclusive` is the
 * next midnight AFTER the window, so the day shown is the one before it —
 * otherwise a 30-day window reads as ending on a day it does not include.
 */
function windowLabel(range: SavedReportView["range"]): string {
  const from = Date.parse(range.from);
  const toExclusive = Date.parse(range.toExclusive);
  if (Number.isNaN(from) || Number.isNaN(toExclusive)) return "";
  const offset = tenantOffsetMs(from);
  const day = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  const local = (instant: number): string => day.format(new Date(instant + offset));
  return `${local(from)} – ${local(toExclusive - 1)}`;
}

/**
 * Description, who can read it and how stale it is — one line, `·`-separated.
 *
 * Three facts that are each too small for a line of their own, and that are
 * read together or not at all: what this report is, whether showing your
 * screen shows it to someone who should not see it, and whether the numbers
 * are the ones you looked at this morning.
 */
function subtitleOf(view: SavedReportView, updatedAt: string, now: Date): string {
  const edited = relativeReportTime(updatedAt, now);
  return [
    view.description ?? "Sem descrição.",
    `visível para ${visibilityLabel(view.visibility).toLocaleLowerCase("pt-BR")}`,
    edited === "" ? "" : `editado ${edited}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/**
 * The header's right edge: export, edit, more — in that order.
 *
 * Three weights, deliberately: `Exportar` is outlined, `Editar` is FILLED, and
 * ⋮ is a bare glyph. They used to render as three similar outlined buttons, so
 * nothing on the screen said which one you were meant to reach for.
 *
 * `ml: auto` pins the cluster to the opposite edge from the title on a shared
 * line, and keeps it right-aligned when the row wraps and it takes a line of
 * its own. `minWidth: 0` lets it give up width instead of pushing ⋮ — the only
 * route to archiving — past the edge of a phone.
 */
function ReportHeaderActions({
  tenantSlug,
  view,
  onEdit,
  onChanged,
}: {
  tenantSlug: string;
  view: SavedReportView;
  onEdit: () => void;
  onChanged: (status: string) => void;
}): JSX.Element {
  return (
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
      <PrintExportButton title={view.name} label="Exportar" dataTestId="report-export-pdf" />
      {/* Editing is the PRIMARY action on a report you are reading, so it is a
          filled button and not only a line in the ⋮ menu — which is where it
          lived, two clicks deep on a screen whose whole purpose is to make you
          want to change something. */}
      <Button
        variant="solid"
        size="sm"
        icon={<PencilIcon />}
        onClick={onEdit}
        dataTestId="report-edit"
      >
        Editar
      </Button>
      <ReportActionsMenu tenantSlug={tenantSlug} view={view} onChanged={onChanged} />
    </Box>
  );
}

function ReportScreenHeader({
  tenantSlug,
  view,
  updatedAt,
  now,
  onBack,
  onEdit,
  onChanged,
}: {
  tenantSlug: string;
  view: SavedReportView;
  /**
   * When the document last changed. It rides in from the LISTING rather than
   * off the view: the run payload answers "what do the numbers say", and the
   * only timestamp it carries is the window's, not the document's.
   */
  updatedAt: string;
  now: Date;
  onBack: () => void;
  onEdit: () => void;
  onChanged: (status: string) => void;
}): JSX.Element {
  return (
    // `Box` + `gap` rather than `Stack spacing` — see `ReportPeriodRow`: Stack's
    // spacing selector outranks a child's own `ml: auto`, which is what pins
    // the action cluster to the opposite edge.
    <Box
      className={NO_PRINT_CLASS}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        rowGap: 1,
        ...CONTROL_ROW_SX,
      }}
    >
      {/* Back INLINE at the far left, vertically centred against the two lines
          it precedes — a compact affordance beside the name, not a breadcrumb
          stacked above it. */}
      <Button variant="ghost" size="sm" onClick={onBack} dataTestId="report-back">
        ← Relatórios
      </Button>
      {/*
        The left column: name + status on one line, the three facts under it.
        `minWidth: 0` is load-bearing — a flex item defaults to `min-width:auto`
        and refuses to shrink below its content, which is how a near-identical
        row in this area measured 455px inside a 390px column and pushed the ⋮
        clean off-screen. `flex-basis` past a phone's width makes it the item
        that takes the whole first line when the row wraps.
      */}
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: "1 1 260px" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <Box component="h1" sx={PAGE_TITLE_SX} data-testid="report-title">
            {view.name}
          </Box>
          <StatusChip status={view.status} />
        </Stack>
        <Text variant="body" size="sm" color="secondary" data-testid="report-subtitle">
          {subtitleOf(view, updatedAt, now)}
        </Text>
      </Stack>
      <ReportHeaderActions
        tenantSlug={tenantSlug}
        view={view}
        onEdit={onEdit}
        onChanged={onChanged}
      />
    </Box>
  );
}

/** Clock — marks the resolved window as a TIME fact, not another control. */
function ClockIcon(): JSX.Element {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * The period band: presets on the left, the window they resolved to on the far
 * right.
 *
 * A full-width band of its own rather than a label beside the segmented
 * control — the preset is a CHOICE and the window is its CONSEQUENCE, and
 * setting them side by side made the second read as a fourth option.
 */
function ReportPeriodRow({
  range,
  onRangeChange,
  resolved,
}: {
  range: ReportRange;
  onRangeChange: (next: ReportRange) => void;
  resolved: string;
}): JSX.Element {
  return (
    // `Box` + `gap`, not `Stack spacing` (FUT-755): MUI's Stack implements its
    // spacing as `& > * + *  { margin-left }`, a two-class selector that beats
    // a child's own `sx` — so `ml: auto` on the window silently lost and it sat
    // glued to the presets instead of at the far edge. Verified in a browser.
    <Box
      className={NO_PRINT_CLASS}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        rowGap: 1,
        width: "100%",
        ...CONTROL_ROW_SX,
      }}
    >
      <RangeToggle value={range} onChange={onRangeChange} dataTestId="report-range" />
      <Box
        sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}
      >
        <ClockIcon />
        <Text variant="body" size="xs" color="secondary" data-testid="report-window">
          {resolved}
        </Text>
      </Box>
    </Box>
  );
}

export function ReportScreen({
  tenantSlug,
  reportId,
  range,
  updatedAt,
  now,
  onRangeChange,
  onBack,
  onEdit,
  onChanged,
}: {
  tenantSlug: string;
  reportId: string;
  range: ReportRange;
  /** The document's last-edit time, from the listing. */
  updatedAt: string;
  now: Date;
  onRangeChange: (next: ReportRange) => void;
  onBack: () => void;
  onEdit: () => void;
  /** Told which lifecycle the report landed in, so the page can navigate. */
  onChanged: (status: string) => void;
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
    <Stack spacing={2} {...{ [PRINT_REGION_ATTR]: "" }} data-testid="page-report">
      <ReportScreenHeader
        tenantSlug={tenantSlug}
        view={view}
        updatedAt={updatedAt}
        now={now}
        onBack={onBack}
        onEdit={onEdit}
        onChanged={onChanged}
      />
      <ReportPeriodRow range={range} onRangeChange={onRangeChange} resolved={windowLabel(view.range)} />
      <ReportViewCanvas view={view} />
    </Stack>
  );
}
