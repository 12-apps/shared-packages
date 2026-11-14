/**
 * A table's flagged rows (FUT-4063): the row tinted with the warning role, and
 * the judged cell carrying an icon and the flag's own words beside the figure —
 * so the mark is never colour alone.
 */
import type { JSX } from "react";

import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/mui/Box";
import { alpha, type Theme } from "@12-apps/ui/mui/styles";

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
    backgroundColor: (theme: Theme) => alpha(theme.palette.warning.main, 0.12),
  },
} as const;

export function FlaggedCell({ text, label }: { text: string; label: string }): JSX.Element {
  return (
    <Box
      component="span"
      data-report-row-flag=""
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        color: "warning.dark",
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
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: "warning.dark" }}
    >
      <Icon name="WarningAmber" size="md" />
      {text}
      <Box component="span" sx={SR_ONLY}>{` ${label}`}</Box>
    </Box>
  );
}
