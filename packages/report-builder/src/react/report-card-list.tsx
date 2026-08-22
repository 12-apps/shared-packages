/**
 * The saved-report list as a CARD GRID (FUT-391, ported in FUT-755).
 *
 * It replaced a `<select>` first, which gave a name and nothing else — no
 * description, no last-edited date, no sense of whether a report was a single
 * chart or a twelve-block dashboard — and then repeated that name as the page
 * heading. Picking between "Vendas" and "Vendas 2" meant opening both.
 *
 * What replaced the select was still a LIST: one full-width row per report,
 * with the filters threaded through the middle of it. `prototype.html`'s
 * `renderList()` is a grid of cards instead, and the difference is not
 * cosmetic — a grid gives every report the same fixed footprint, so the
 * screen answers "which of these is the one I want" by comparison rather than
 * by reading each row in turn. This module is that grid: the toolbar and the
 * card live in their own files, and what is left here is the composition and
 * the one state a grid can be in that a row cannot — empty.
 */
import type { JSX } from "react";

import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { CardGrid } from "@12-apps/ui/layout/CardGrid";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";

import type { SavedReportSummary } from "./custom-reports-api";
import { NewReportCard, ReportCard } from "./report-card";
import { filterReports, type ReportScope } from "./report-list-filters";
import { ReportListToolbar } from "./report-list-toolbar";
import { useReportCopy } from "./transport-context";

/** The prototype's `minmax(268px, 1fr)` — two cards on a phone-wide tablet. */
const CARD_MIN_WIDTH_PX = 268;

/**
 * Nothing matched — and WHY nothing matched is the whole message.
 *
 * A search that found nothing is a typo away from working, so it says so; an
 * empty scope is an invitation, so it names three reports worth building. One
 * string for both would be wrong in one of the two cases, which is how an
 * empty state ends up saying "Nenhum resultado" to someone who has never
 * created anything.
 */
function NoMatches({ searching, onCreate }: { searching: boolean; onCreate: () => void }): JSX.Element {
  const copy = useReportCopy().screens.list;
  return (
    <Box
      sx={{
        // Spans the whole grid, in the cell the cards would have filled.
        gridColumn: "1 / -1",
        // `EmptyState` builds its action from MUI's own `Button`, which
        // uppercases — so this one control shouted `NOVO RELATÓRIO` while the
        // identical button in the toolbar two rows above reads `Novo
        // relatório`. `visual-pass.md` §Components: one button case across the
        // product, sentence case. `lib/confirm-dialog.tsx` restates the same
        // rule for `AlertDialog`, for the same reason.
        "& .MuiButton-root": { textTransform: "none" },
      }}
    >
      <EmptyState
        variant="minimal"
        title={copy.emptyTitle}
        description={
          searching
            ? copy.emptySearchBody
            : copy.emptyBody
        }
        primaryAction={{ label: copy.create, onClick: onCreate }}
        dataTestId="reports-empty"
      />
    </Box>
  );
}

export function ReportCardList({
  reports,
  scope,
  search,
  now = new Date(),
  onScopeChange,
  onSearchChange,
  onSelect,
  onEdit,
  onArchive,
  onCreate,
}: {
  reports: readonly SavedReportSummary[];
  scope: ReportScope;
  search: string;
  /**
   * The instant the cards' "há 2 min" is measured against. Injected rather
   * than read from the clock inside the card so the relative times on one
   * screen all agree, and so a test can state a time instead of stubbing one.
   */
  now?: Date;
  onScopeChange: (scope: ReportScope) => void;
  onSearchChange: (search: string) => void;
  onSelect: (id: string) => void;
  /** The ⋮ menu's edit action — the editor route belongs to the host's router. */
  onEdit: (id: string) => void;
  /** The ⋮ menu's archive/restore; the caller owns the confirmation and write. */
  onArchive: (report: SavedReportSummary) => void;
  onCreate: () => void;
}): JSX.Element {
  // Nothing is "kept" past the filters any more: opening a report NAVIGATES
  // (FUT-755), so the grid has no current selection to protect from a scope
  // change, and a grid that kept showing one card while you typed a term it
  // does not match read as broken search.
  const searching = search.trim() !== "";
  const visible = filterReports(reports, { scope, search });

  return (
    <Stack spacing={2}>
      <ReportListToolbar
        scope={scope}
        search={search}
        onScopeChange={onScopeChange}
        onSearchChange={onSearchChange}
        onCreate={onCreate}
      />

      <CardGrid variant="fluid" cardWidth={CARD_MIN_WIDTH_PX} gridTestId="reports-card-list">
        {visible.length === 0 ? (
          <NoMatches searching={searching} onCreate={onCreate} />
        ) : (
          <>
            {visible.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                now={now}
                onSelect={() => onSelect(report.id)}
                onEdit={() => onEdit(report.id)}
                onArchive={() => onArchive(report)}
              />
            ))}
            {/* Last cell, not a toolbar echo: the grid ENDS in the way to add
                one more, so the affordance is where the eye already is after
                reading the cards. */}
            <NewReportCard onCreate={onCreate} />
          </>
        )}
      </CardGrid>
    </Stack>
  );
}
