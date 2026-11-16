/**
 * A table's flagged rows (FUT-4063): the row tinted with the warning role, and
 * the judged cell carrying an icon and the flag's own words beside the figure —
 * so the mark is never colour alone.
 */
import type { JSX } from "react";

import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/mui/Box";
import { readableInk, roleInk, tintOver } from "@12-apps/ui/data-display/HeatMap";
import type { Theme } from "@12-apps/ui/mui/styles";

import type { ReportRow, ReportTableFlag } from "../reports-api";
import { FLAGGED_ROW_KEY } from "./report-table-columns";

/** The rows with the client-side mark on the flagged ones; the others untouched. */
export function withFlagMarks(rows: ReportRow[], flag: ReportTableFlag | undefined): Array<Record<string, unknown>> {
  if (!flag || flag.rows.length === 0) return rows;
  const marked = new Set(flag.rows);
  return rows.map((row, index) => (marked.has(index) ? { ...row, [FLAGGED_ROW_KEY]: true } : row));
}

/**
 * The row tint, reached through the flagged cell (`:has`), because the design
 * system's `Table` takes no per-row style. A tint of the WARNING role: amber is
 * "over the line", not "failed".
 */
export const FLAGGED_ROW_SX = {
  "& .MuiTable-root .MuiTableBody-root .MuiTableRow-root:has([data-report-row-flag])": {
    backgroundColor: (theme: Theme) => flaggedRowTint(theme),
  },
} as const;

/** How much of the warning role a flagged row is washed with. */
const FLAGGED_TINT = 0.12;

/** A flagged row's fill: the warning role washed over the card, as one opaque colour. */
export function flaggedRowTint(theme: Theme): string {
  return tintOver(theme, theme.palette.warning.main, FLAGGED_TINT);
}

/**
 * The flag's ink on a flagged row (FUT-4063): the warning role's shade for the
 * theme's MODE, or the palette's contrast text where that shade does not reach
 * 4.5:1 — so the words read in a host's dark palette too.
 */
export function flaggedRowInk(theme: Theme): string {
  return readableInk(theme, flaggedRowTint(theme), [roleInk(theme, "warning")]);
}

/**
 * The flag's ink on the plain card (a KPI figure): the same rule, on the card's
 * own ground, at the BODY-text floor of 4.5:1. `StatCard`'s figure is 20px at
 * weight 500, which is not WCAG large text (24px, or 18.66px bold), so where the
 * role's shade falls short (MUI's own amber, 3.8:1 on white) the figure takes the
 * contrast ink and the icon carries the signal.
 */
export function flaggedFigureInk(theme: Theme): string {
  return readableInk(theme, tintOver(theme, theme.palette.warning.main, 0), [roleInk(theme, "warning")]);
}

export function FlaggedCell({ text, label }: { text: string; label: string }): JSX.Element {
  return (
    <Box
      component="span"
      data-report-row-flag=""
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        color: flaggedRowInk,
        fontWeight: "fontWeightBold",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name="WarningAmber" size="sm" />
      {`${text} · ${label}`}
    </Box>
  );
}

/** Visually hidden, still read: the flag's words beside an icon-only mark. */
const SR_ONLY = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
} as const;

/**
 * A KPI figure over its whole-period target (FUT-4063): amber, with the icon,
 * and the flag's words for a screen reader. The visible sentence is the host's
 * hint under the figure, so the words are not printed twice.
 */
export function FlaggedFigure({ text, label }: { text: string; label: string }): JSX.Element {
  return (
    <Box
      component="span"
      data-report-figure-flag=""
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: flaggedFigureInk }}
    >
      <Icon name="WarningAmber" size="md" />
      {text}
      <Box component="span" sx={SR_ONLY}>{` ${label}`}</Box>
    </Box>
  );
}
