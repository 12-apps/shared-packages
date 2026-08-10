/**
 * The saved-report list as CARDS (FUT-391).
 *
 * It replaced a `<select>`, which gave a name and nothing else — no
 * description, no last-edited date, no sense of whether a report was a single
 * chart or a twelve-block dashboard — and then repeated that name as the page
 * heading. Picking between "Vendas" and "Vendas 2" meant opening both.
 *
 * "Mostrar arquivados" was a floating checkbox beside it, which made archiving
 * read as a display toggle rather than as one of the list's states; it becomes
 * a scope pill next to the search.
 */
import type { JSX } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { SavedReportSummary } from "./custom-reports-api";
import { CONTAINER_RADIUS_PX, CONTROL_ROW_SX } from "./lib/report-surface";
import {
  REPORT_SCOPE_LABELS,
  filterReports,
  scopeCounts,
  type ReportScope,
} from "./report-list-filters";

const SCOPES: ReportScope[] = ["active", "archived"];

/**
 * The card's name, as a TITLE that happens to be clickable.
 *
 * It was a plain `Button variant="text"`, which had it rendering in the accent
 * at 14/500 — **4.47:1** on the card, under the 4.5:1 floor for body text, and
 * this is the primary click target on the landing screen. A text button is also
 * centred, so the one line that names the card sat centred above its own
 * description and status, both of them left-aligned.
 *
 * `color="neutral"` puts it back on `text.primary` (15.9:1) and the overrides
 * below make the control the shape of the text inside it rather than the shape
 * of a button: full width, left-aligned, no padding of its own.
 */
const CARD_TITLE_SX = {
  justifyContent: "flex-start",
  textAlign: "left",
  textTransform: "none",
  p: 0,
  minWidth: 0,
  width: "100%",
  boxShadow: "none",
  "&:hover": { bgcolor: "transparent" },
} as const;

/** A draft or archived report says so; a published one needs no badge. */
function statusNote(report: SavedReportSummary): string | null {
  if (report.status === "archived") return "Arquivado";
  if (report.status === "draft") return "Rascunho";
  return null;
}

/** "Painel · 3 coleções" — what the name alone never said. */
function shapeNote(report: SavedReportSummary): string {
  const kind = report.type === "dashboard" ? "Painel" : "Relatório";
  const count = report.entities.length;
  return count > 1 ? `${kind} · ${count} coleções` : kind;
}

function ReportCard({
  report,
  selected,
  onSelect,
}: {
  report: SavedReportSummary;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const note = statusNote(report);
  return (
    <Card
      variant="outlined"
      sx={{
        p: 2,
        cursor: "pointer",
        bgcolor: "background.paper",
        boxShadow: "none",
        borderRadius: `${CONTAINER_RADIUS_PX}px`,
        ...(selected ? { outline: "2px solid", outlineColor: "primary.main" } : {}),
      }}
      onClick={onSelect}
      data-testid={`reports-card-${report.id}`}
    >
      {/* A real button inside the card, not a click handler alone: the card is
          reachable by keyboard and announced as the control it is. */}
      <Stack spacing={0.5}>
        <Button
          variant="text"
          color="neutral"
          size="sm"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          sx={CARD_TITLE_SX}
          data-testid={`reports-card-${report.id}-open`}
        >
          <Text variant="heading" size="lg" weight="semibold" as="span">
            {report.name}
          </Text>
        </Button>
        {report.description ? (
          <Text variant="body" size="sm" color="secondary">
            {report.description}
          </Text>
        ) : null}
        {/*
          Status is a STATE, not more prose (FUT-755). It read as ` · Arquivado`
          inside the same grey caption as the shape note, so the one thing that
          changes what a card MEANS looked like the one thing that never
          changes. `inventory.md` §1 is blunt about it: the prototype is right
          and we are wrong. A published report still carries no badge.
        */}
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Text variant="body" size="xs" color="secondary">
            {shapeNote(report)}
          </Text>
          {note ? <Chip label={note} size="sm" variant="outlined" /> : null}
        </Stack>
      </Stack>
    </Card>
  );
}

export function ReportCardList({
  reports,
  selectedId,
  scope,
  search,
  onScopeChange,
  onSearchChange,
  onSelect,
  onCreate,
}: {
  reports: readonly SavedReportSummary[];
  selectedId: string;
  scope: ReportScope;
  search: string;
  onScopeChange: (scope: ReportScope) => void;
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}): JSX.Element {
  const counts = scopeCounts(reports);
  // The selected report is kept whatever the filters say — losing the thing
  // you are looking at because you typed in a search box is a worse surprise
  // than an out-of-scope card.
  const visible = filterReports(reports, { scope, search, keepId: selectedId });

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, ...CONTROL_ROW_SX }}
      >
        {SCOPES.map((option) => (
          <Button
            key={option}
            variant={option === scope ? "solid" : "outline"}
            size="sm"
            aria-pressed={option === scope}
            onClick={() => onScopeChange(option)}
            data-testid={`reports-scope-${option}`}
          >
            {REPORT_SCOPE_LABELS[option]} ({counts[option]})
          </Button>
        ))}
        <Box sx={{ minWidth: 220 }}>
          <Input
            size="sm"
            aria-label="Buscar relatórios"
            placeholder="Buscar…"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            data-testid="reports-search"
          />
        </Box>
        <Button variant="solid" size="sm" onClick={onCreate} data-testid="reports-new">
          Novo relatório
        </Button>
      </Stack>

      {visible.length === 0 ? (
        <Text variant="body" size="sm" color="secondary" data-testid="reports-none-match">
          Nenhum relatório encontrado.
        </Text>
      ) : (
        <Stack spacing={1} data-testid="reports-card-list">
          {visible.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              selected={report.id === selectedId}
              onSelect={() => onSelect(report.id)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
