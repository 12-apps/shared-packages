/**
 * The chrome a built-in surface wears: the period presets, the date-grain
 * toggle when the surface buckets by date, print + CSV export, and the "back to
 * the section" link.
 *
 * Extracted from the single-report viewer when the consolidated section
 * dashboard arrived (FUT-000). The two must offer the SAME period controls —
 * a dashboard whose window worked differently from the reports it merges would
 * defeat the reason for merging them — and sharing the row is how that stays
 * true without either page re-deciding it.
 */
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { SystemReportSection } from "../../server/system-reports";

import {
  reportGrainLabel,
  REPORT_GRAINS,
  reportRangeLabel,
  REPORT_ROLLING_RANGES,
  type ReportGrain,
  type ReportRange,
} from "../reports-api";
import { OneLineChoice } from "./one-line-choice";
import { NO_PRINT_CLASS, PrintExportButton } from "./print-export";
import type { ReportBuilderPanelCopy, ReportRangeCopy } from "../screens-copy";
import {
  useReportCopy,
  useReportSurface,
  type ReportBuilderSurface,
  type ReportPeriodSurface,
} from "../transport-context";

/**
 * ROLLING presets only — no `Personalizado…` on a built-in surface (FUT-755).
 *
 * That pill is not a period; it opens a picker whose two dates then have to
 * travel with every request. These surfaces hold their period as a bare
 * `useState<ReportRange>` and hand it straight to `useSystemReport`, so the
 * pill would send `preset=custom` with nothing to resolve — a 400 from a
 * control that looked fine. `Este mês` needs no dates, so it IS offered here.
 */
function rangeOptions(
  copy: ReportRangeCopy,
  offered: readonly ReportRange[] = REPORT_ROLLING_RANGES,
): Array<{ value: ReportRange; label: string }> {
  return offered.map((range) => ({ value: range, label: reportRangeLabel(range, copy) }));
}

/**
 * The period a built-in OPENS on (FUT-4063): the FIRST it offers — the host
 * orders its list with the default first ("Esta semana", then the rest). A
 * built-in that offers no list opens on `30d`, as every built-in always has.
 */
export function initialRange(offered: readonly ReportRange[] | undefined): ReportRange {
  return offered?.[0] ?? "30d";
}

/**
 * The grain a built-in OPENS on (FUT-4063): `day` where it is offered, else
 * the first grain the report offers — never one its toggle does not show.
 */
export function initialGrain(offered: readonly ReportGrain[] | undefined): ReportGrain {
  if (!offered || offered.length === 0 || offered.includes("day")) return "day";
  return offered[0] ?? "day";
}

/**
 * The host's whole label for every period this surface offers, or `undefined`
 * when the host labels none of them HERE (FUT-4063): `periodLabel` answering
 * `undefined` for a surface keeps that surface on the toggle, so a host can
 * give one built-in "Esta semana · 09–15/11" and leave the rest as they were.
 * A host label for only SOME periods is completed from the package's own words.
 */
function hostPeriodLabels(
  ranges: readonly ReportRange[],
  periodLabel: ReportBuilderSurface["periodLabel"],
  surface: ReportPeriodSurface,
  fallback: (range: ReportRange) => string,
): Map<ReportRange, string> | undefined {
  if (!periodLabel) return undefined;
  const labels = new Map<ReportRange, string>();
  for (const range of ranges) {
    const label = periodLabel(range, surface);
    if (label !== undefined) labels.set(range, label);
  }
  if (labels.size === 0) return undefined;
  for (const range of ranges) if (!labels.has(range)) labels.set(range, fallback(range));
  return labels;
}

/**
 * The period control: the preset toggle, or — when the host formats a label
 * per period for THIS surface (`surface.periodLabel`, FUT-4063) — a select
 * whose trigger reads the current period whole, "Esta semana · 03–09/11". The
 * toggle itself becomes a select on a row too narrow for its labels on one line.
 */
function PeriodControl({
  range,
  onRangeChange,
  offered,
  surface,
}: Pick<ReportControlsProps, "range" | "onRangeChange" | "surface"> & { offered?: readonly ReportRange[] }): JSX.Element {
  const ranges = useReportCopy().screens.ranges;
  const copy = useReportCopy().screens.builder;
  const { periodLabel } = useReportSurface();
  const options = rangeOptions(ranges, offered);
  const hostLabels = hostPeriodLabels(
    options.map((option) => option.value),
    periodLabel,
    surface,
    (range) => reportRangeLabel(range, ranges),
  );
  return (
    <OneLineChoice
      options={hostLabels ? options.map((option) => ({ ...option, label: hostLabels.get(option.value) ?? option.label })) : options}
      value={range}
      onChange={onRangeChange}
      label={copy.period}
      dataTestId="report-range"
      select={hostLabels !== undefined}
    />
  );
}

function grainOptions(
  copy: ReportRangeCopy,
  grains: readonly ReportGrain[] = REPORT_GRAINS,
): Array<{ value: ReportGrain; label: string }> {
  return REPORT_GRAINS.filter((grain) => grains.includes(grain)).map((grain) => ({
    value: grain,
    label: reportGrainLabel(grain, copy),
  }));
}

interface ReportControlsProps {
  range: ReportRange;
  onRangeChange: (range: ReportRange) => void;
  grain: ReportGrain;
  onGrainChange: (grain: ReportGrain) => void;
  showGrain: boolean;
  /** The grains the toggle offers (FUT-4063); absent means all three. */
  grains?: readonly ReportGrain[];
  /** The grain toggle's name (FUT-4063), e.g. "Agrupar por"; absent = the builder's word. */
  grainLabel?: string;
  /** The periods offered (FUT-4063); absent = the rolling four. */
  ranges?: readonly ReportRange[];
  /** The surface this row controls, passed to the host's `periodLabel` (FUT-4063). */
  surface: ReportPeriodSurface;
  printTitle: string;
  /**
   * CSV of the whole surface. A dashboard has one file per block instead, so
   * it omits this and puts the button on each block's frame.
   */
  onExport?: () => void;
}

/** The shared chrome row: period presets, optional grain toggle, exports. */
export function ReportControls({
  range,
  onRangeChange,
  grain,
  onGrainChange,
  showGrain,
  grains,
  grainLabel,
  ranges: offered,
  surface,
  printTitle,
  onExport,
}: ReportControlsProps): JSX.Element {
  const ranges = useReportCopy().screens.ranges;
  const copy = useReportCopy().screens.builder;
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      className={NO_PRINT_CLASS}
    >
      <PeriodControl range={range} onRangeChange={onRangeChange} offered={offered} surface={surface} />
      {showGrain ? (
        <OneLineChoice
          options={grainOptions(ranges, grains)}
          value={grain}
          onChange={onGrainChange}
          label={grainLabel ?? copy.grouping}
          dataTestId="report-grain"
        />
      ) : null}
      <Box sx={{ ml: "auto", display: "flex", gap: 8 }}>
        <PrintExportButton title={printTitle} label={copy.exportPdf} />
        {onExport ? (
          <Button variant="outline" size="sm" onClick={onExport} data-testid="report-export-csv">
            {copy.exportCsv}
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}

/**
 * Where "back" goes from a built-in surface: the SECTION it analyses, not the
 * Relatórios area (which no longer lists the built-ins).
 *
 * Both halves are the HOST's and both are now declared rather than guessed. The
 * label was a hardcoded `{ orders: "Pedidos", inventory: "Estoque", kitchen:
 * "Cozinha" }` — one product's vocabulary, in one language, for three sections
 * only that product has. The href was `/{tenantSlug}/{section}`, which quietly
 * asserted that a section key IS a host's URL segment; it is not, for any host
 * whose stock area lives at `/inventory/movements`.
 *
 * An unknown section falls back to THIS surface's own root, which is the one
 * path that is guaranteed to exist — never the host's `/dashboard`, which this
 * package has no reason to believe in.
 */
export function sectionBackTarget(
  tenantSlug: string,
  sections: readonly SystemReportSection[],
  section: string | undefined,
  copy: ReportBuilderPanelCopy,
): { href: string; label: string } {
  const declared = sections.find((candidate) => candidate.key === section);
  if (!declared) return { href: `/${tenantSlug}/reports`, label: copy.backToList };
  return { href: `/${tenantSlug}/${declared.path}`, label: declared.label };
}

/** The heading block every built-in surface opens with: back link, title, blurb. */
export function ReportPageHeader({
  back,
  title,
  description,
  titleTestId,
  backTestId,
}: {
  back: { href: string; label: string };
  title: string;
  description: string;
  titleTestId: string;
  backTestId: string;
}): JSX.Element {
  return (
    <Stack spacing={0.5}>
      <Link to={back.href} data-testid={backTestId} className={NO_PRINT_CLASS}>
        <Text variant="body" size="sm" color="secondary">
          ← {back.label}
        </Text>
      </Link>
      <Text variant="heading" size="lg" as="h1" data-testid={titleTestId}>
        {title}
      </Text>
      <Text variant="body" size="sm" color="secondary">
        {description}
      </Text>
    </Stack>
  );
}
