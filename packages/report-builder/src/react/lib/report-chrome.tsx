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
import { ToggleGroup } from "@12-apps/ui/form/ToggleGroup";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import {
  REPORT_GRAIN_LABELS,
  REPORT_GRAINS,
  REPORT_RANGE_LABELS,
  REPORT_ROLLING_RANGES,
  type ReportGrain,
  type ReportRange,
} from "../reports-api";
import { NO_PRINT_CLASS, PrintExportButton } from "./print-export";

/**
 * ROLLING presets only — no `Personalizado…` on a built-in surface (FUT-755).
 *
 * That pill is not a period; it opens a picker whose two dates then have to
 * travel with every request. These surfaces hold their period as a bare
 * `useState<ReportRange>` and hand it straight to `useSystemReport`, so the
 * pill would send `preset=custom` with nothing to resolve — a 400 from a
 * control that looked fine. `Este mês` needs no dates, so it IS offered here.
 */
const RANGE_OPTIONS = REPORT_ROLLING_RANGES.map((range) => ({
  value: range,
  label: REPORT_RANGE_LABELS[range],
}));

const GRAIN_OPTIONS = REPORT_GRAINS.map((grain) => ({
  value: grain,
  label: REPORT_GRAIN_LABELS[grain],
}));

interface ReportControlsProps {
  range: ReportRange;
  onRangeChange: (range: ReportRange) => void;
  grain: ReportGrain;
  onGrainChange: (grain: ReportGrain) => void;
  showGrain: boolean;
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
  printTitle,
  onExport,
}: ReportControlsProps): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      className={NO_PRINT_CLASS}
    >
      <ToggleGroup
        variant="exclusive"
        size="sm"
        options={RANGE_OPTIONS}
        value={range}
        onChange={(_event, next) => {
          if (typeof next === "string") onRangeChange(next as ReportRange);
        }}
        aria-label="Período"
        dataTestId="report-range"
      />
      {showGrain ? (
        <ToggleGroup
          variant="exclusive"
          size="sm"
          options={GRAIN_OPTIONS}
          value={grain}
          onChange={(_event, next) => {
            if (typeof next === "string") onGrainChange(next as ReportGrain);
          }}
          aria-label="Agrupamento"
          dataTestId="report-grain"
        />
      ) : null}
      <Box sx={{ ml: "auto", display: "flex", gap: 8 }}>
        <PrintExportButton title={printTitle} />
        {onExport ? (
          <Button variant="outline" size="sm" onClick={onExport} data-testid="report-export-csv">
            Exportar CSV
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}

/** The host's label for each section a built-in surface can belong to. */
const SECTION_LABELS: Record<string, string> = {
  orders: "Pedidos",
  inventory: "Estoque",
  // FUT-454. The href `/{slug}/kitchen` is already the Cozinha route, so only
  // the label was missing — and without it "back" reads as the generic
  // "Voltar" rather than naming where it goes.
  kitchen: "Cozinha",
};

/**
 * Where "back" goes from a built-in surface: the SECTION it analyses, not the
 * Relatórios area (which no longer lists the built-ins). The host mounts each
 * section at `/{tenantSlug}/{section}`, so the section key is the path segment.
 */
export function sectionBackTarget(
  tenantSlug: string,
  section: string | undefined,
): { href: string; label: string } {
  if (!section) return { href: `/${tenantSlug}/dashboard`, label: "Início" };
  return { href: `/${tenantSlug}/${section}`, label: SECTION_LABELS[section] ?? "Voltar" };
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
