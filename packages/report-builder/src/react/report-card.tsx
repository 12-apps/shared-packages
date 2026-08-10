/**
 * One report in the list, as a CARD (FUT-755) — `prototype.html`'s `.card`.
 *
 * The screen used to be one full-width row per report, with the scope buttons,
 * the search box and the new-report button laid inline through the middle of
 * it. That is a table pretending to be a list: a row can only ever grow
 * sideways, so the things that actually distinguish two saved reports — how
 * big the report is, who can see it, how stale it is — had nowhere to go.
 *
 * A card has a bottom. Everything below the title lands in it: the description
 * (two lines, clamped), a sparkline standing in for the document's size, and a
 * footer that reads "3 blocos · Toda a equipe · há 2 min".
 */
import type { CSSProperties, JSX } from "react";

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Button } from "@12-apps/ui/form/Button";
import { Card } from "@12-apps/ui/layout/Card";
import { DropdownMenu, type DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { useTheme } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import type { SavedReportSummary } from "./custom-reports-api";
import { PlusIcon } from "./lib/block-icons";
import { CONTAINER_RADIUS_PX, stateChipSx } from "./lib/report-surface";
import { blockCountLabel, relativeReportTime, visibilityLabel } from "./report-list-filters";

/** The card's ⋮, revealed by hover OR focus — see {@link CARD_SX}. */
const MENU_ATTR = "data-report-card-menu";

/**
 * The card frame, and the one rule that makes the ⋮ keyboard-reachable.
 *
 * `prototype.html` reveals the menu with `.card:hover .card-menu` **and**
 * `.card:focus-within .card-menu`. The second half is not decoration: a menu
 * that only appears under a pointer is a control a keyboard user can tab into
 * and never see, which is worse than one that is always visible. Both halves
 * are carried here so neither can be dropped without the other being noticed.
 */
const CARD_SX = {
  position: "relative",
  height: "100%",
  p: 0,
  overflow: "hidden",
  boxShadow: "none",
  bgcolor: "background.paper",
  borderRadius: `${CONTAINER_RADIUS_PX}px`,
  transition: "border-color .12s, box-shadow .12s",
  "&:hover": { borderColor: "text.disabled", boxShadow: "0 6px 20px -14px rgba(20,23,38,.4)" },
  [`&:hover [${MENU_ATTR}], &:focus-within [${MENU_ATTR}]`]: { opacity: 1 },
} as const;

/** The whole card is the click target; the button is its shape, not a chip. */
const OPEN_SX = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "flex-start",
  textAlign: "left",
  textTransform: "none",
  width: "100%",
  height: "100%",
  p: 2,
  // The card owns the hover surface (see `CARD_SX`), so the button stays
  // transparent — otherwise its own 8px control radius would paint a visibly
  // squarer rectangle inside the card's 12px corners on every hover.
  bgcolor: "transparent",
  boxShadow: "none",
  "&:hover": { bgcolor: "transparent" },
} as const;

/** Two lines of description, then an ellipsis — never a card twice as tall. */
const CLAMP_2: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const SPARK_MAX_BARS = 6;

/**
 * Bar heights for the card's sparkline, in px — `prototype.html`'s
 * `8 + ((i*7) % 14)`, which alternates 8 and 15.
 *
 * It is NOT a chart and deliberately not drawn with one: there is no series
 * here, only a count, and rendering a count through `@12-apps/ui/charts` would
 * dress a single number up as measured data. What it encodes is size — one bar
 * reads as a single chart, six as a full dashboard — and it saturates at six
 * because past that the difference stops being legible anyway.
 *
 * An empty document still draws two bars rather than nothing, so a card never
 * has a blank strip where every other card has a mark.
 */
function sparkBars(blockCount: number): number[] {
  const count = Math.min(blockCount > 0 ? blockCount : 2, SPARK_MAX_BARS);
  return Array.from({ length: count }, (_, index) => 8 + ((index * 7) % 14));
}

function Sparkline({ blockCount }: { blockCount: number }): JSX.Element {
  return (
    <Box
      aria-hidden="true"
      sx={{ display: "flex", gap: "3px", height: 22, alignItems: "flex-end", opacity: 0.85 }}
    >
      {sparkBars(blockCount).map((height, index) => (
        <Box
          // The bars have no identity beyond their position — they are one
          // drawing, not a list of things.
          key={index}
          sx={{ width: "5px", height, borderRadius: "2px", bgcolor: "primary.main", opacity: 0.55 }}
        />
      ))}
    </Box>
  );
}

/** `Rascunho` while unpublished, `Arquivado` once archived; published says nothing. */
function StatusChips({ report }: { report: SavedReportSummary }): JSX.Element | null {
  const theme = useTheme();
  if (report.status !== "draft" && report.status !== "archived") return null;
  const draft = report.status === "draft";
  return (
    // The tint and the label colour are computed against the surface (see
    // `stateChipSx`), and `Chip` takes no `sx` of its own — so they arrive
    // through the wrapper, which is also what keeps the chip on the design
    // system's component rather than a hand-rolled span.
    <Box
      sx={{
        display: "inline-flex",
        "& .MuiChip-root": stateChipSx(
          draft ? theme.palette.warning.main : theme.palette.text.secondary,
          theme.palette.background.paper,
        ),
      }}
    >
      <Chip label={draft ? "Rascunho" : "Arquivado"} size="sm" variant="filled" />
    </Box>
  );
}

/** "3 blocos · Toda a equipe" on the left, "há 2 min" pushed to the right. */
function CardFooter({ report, now }: { report: SavedReportSummary; now: Date }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "center", mt: "auto", pt: 0.75, width: "100%", minWidth: 0 }}
    >
      <Text variant="body" size="xs" color="secondary" as="span">
        {blockCountLabel(report.blockCount)}
      </Text>
      <Text variant="body" size="xs" color="secondary" as="span" aria-hidden="true">
        ·
      </Text>
      <Text variant="body" size="xs" color="secondary" as="span">
        {visibilityLabel(report.visibility)}
      </Text>
      <Box sx={{ flex: 1 }} />
      <Text variant="body" size="xs" color="secondary" as="span">
        {relativeReportTime(report.updatedAt, now)}
      </Text>
    </Stack>
  );
}

/** Everything inside the card, in reading order: name, what, how big, when. */
function CardBody({ report, now }: { report: SavedReportSummary; now: Date }): JSX.Element {
  return (
    <Stack spacing={1} sx={{ width: "100%", height: "100%", minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        // `pr` leaves the ⋮ its corner: without it a long name runs under the
        // menu, which is invisible until you hover the card that has it.
        sx={{ alignItems: "flex-start", flexWrap: "wrap", rowGap: 0.5, pr: 3.5 }}
      >
        <Text variant="heading" size="lg" weight="semibold" as="h3">
          {report.name}
        </Text>
        <StatusChips report={report} />
      </Stack>
      <Text variant="body" size="sm" color="secondary" as="p" style={CLAMP_2}>
        {report.description ?? "Sem descrição."}
      </Text>
      <Sparkline blockCount={report.blockCount} />
      <CardFooter report={report} now={now} />
    </Stack>
  );
}

/**
 * The card's ⋮, as a SIBLING of the open button rather than a child of it.
 *
 * A button inside a button is invalid HTML and browsers recover from it by
 * dropping the inner control — which is exactly what the prototype nests, and
 * exactly the control a keyboard user would then be unable to reach.
 *
 * Two items. The prototype's stub menu names two more, and both are absent on
 * purpose rather than silently dropped: `Duplicar` needs the stored document as
 * authored content (see `report-list-archive.tsx`), and `Compartilhar link`
 * needs an absolute URL this component cannot build — the surface mounts under
 * a host router whose base it does not know.
 */
function CardMenu({
  report,
  onEdit,
  onArchive,
}: {
  report: SavedReportSummary;
  onEdit: () => void;
  onArchive: () => void;
}): JSX.Element {
  const items: DropdownMenuItem[] = [
    { id: "edit", label: "Editar", onClick: onEdit },
    {
      id: "archive",
      // Reachable from the CARD because opening a report now navigates away
      // (FUT-755); without it, filing a report costs a round trip and back.
      label: report.status === "archived" ? "Restaurar" : "Arquivar",
      onClick: onArchive,
    },
  ];
  return (
    <Box
      {...{ [MENU_ATTR]: "" }}
      sx={{
        position: "absolute",
        top: 6,
        right: 6,
        opacity: 0,
        transition: "opacity .12s",
        // Focus reveals it (`CARD_SX`), so it must not be skipped while
        // invisible — `opacity` keeps it in the tab order, `display: none`
        // would not.
        "&:focus-within": { opacity: 1 },
      }}
    >
      <DropdownMenu
        size="sm"
        items={items}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Mais ações de ${report.name}`}
            dataTestId={`reports-card-${report.id}-menu`}
          >
            ⋮
          </Button>
        }
      />
    </Box>
  );
}

export function ReportCard({
  report,
  now,
  onSelect,
  onEdit,
  onArchive,
}: {
  report: SavedReportSummary;
  now: Date;
  onSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
}): JSX.Element {
  return (
    <Card variant="outlined" sx={CARD_SX} dataTestId={`reports-card-${report.id}`}>
      {/* A real button, not a click handler on the card: the whole card opens
          the report, and it does so from the keyboard too. */}
      <Button
        variant="text"
        color="neutral"
        onClick={onSelect}
        sx={OPEN_SX}
        dataTestId={`reports-card-${report.id}-open`}
      >
        <CardBody report={report} now={now} />
      </Button>
      <CardMenu report={report} onEdit={onEdit} onArchive={onArchive} />
    </Card>
  );
}

/** The dashed tile that closes the grid — `prototype.html`'s `.card.new`. */
export function NewReportCard({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <Button
      variant="text"
      color="neutral"
      onClick={onCreate}
      dataTestId="reports-card-new"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        textTransform: "none",
        width: "100%",
        height: "100%",
        minHeight: 140,
        p: 2,
        border: "1px dashed",
        borderColor: "divider",
        borderRadius: `${CONTAINER_RADIUS_PX}px`,
        boxShadow: "none",
        "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
      }}
    >
      <PlusIcon />
      <Text variant="body" size="sm" weight="semibold" as="span">
        Novo relatório
      </Text>
      <Text variant="body" size="xs" color="secondary" as="span">
        Comece de um modelo
      </Text>
    </Button>
  );
}
