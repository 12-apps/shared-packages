"use client";

/**
 * A QUICK CHIP — the toolbar's one-click filter (see `QuickFilterConfig`).
 *
 * Its own module because it is drawn in two places: on the bar, as a
 * pill-shaped toggle with its count, and inside "Mais" when the ladder had no
 * room for it, as a toggle row with the same label and count. Both write the
 * same state through `onToggleQuick`, so where the chip sits never changes what
 * it does.
 *
 * Hand-drawn rather than `Toggle` (MUI ToggleButton), as the range preset chips
 * beside it are: a ToggleButton is a squared group member with its own
 * selected tint, and this is a standalone pill whose pressed state INVERTS —
 * the approved Estoque prototype's chip, pill radius included.
 */
import Checkbox from "@mui/material/Checkbox/index.js";
import type { Theme } from "@mui/material/styles/index.js";

import { Box } from "../../../mui/Box";
import { fieldHeight } from "../../../tokens/field-height";
import { fieldEdge } from "../../../tokens/field-edge";
import { sxRem } from "../../../tokens/relative";

import type { QuickFilterConfig } from "./data-views-types";

/** The count's colour: the attention the rows need, or neutral. */
function toneColor(theme: Theme, tone: QuickFilterConfig["tone"]): string {
  return tone ? theme.palette[tone].main : theme.palette.text.secondary;
}

/** The chip on the toolbar: pressed reads as a filled, inverted pill. */
export function QuickChip({
  quick,
  active,
  onToggle,
  testIdPrefix,
}: {
  quick: QuickFilterConfig;
  active: boolean;
  onToggle: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      data-testid={`${testIdPrefix}-quick-${quick.id}`}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        minHeight: fieldHeight,
        px: 1.5,
        border: 1,
        borderStyle: "solid",
        borderColor: (theme: Theme) => (active ? theme.palette.text.primary : fieldEdge(theme)),
        borderRadius: 999,
        bgcolor: active ? "text.primary" : "background.paper",
        color: active ? "background.paper" : "text.primary",
        cursor: "pointer",
        font: "inherit",
        fontSize: sxRem(13),
        fontWeight: 500,
        whiteSpace: "nowrap",
        "&:hover": { borderColor: "text.primary" },
        "&:focus-visible": {
          outlineWidth: sxRem(2),
          outlineStyle: "solid",
          outlineColor: "primary.main",
          // Inset, as the scope tabs draw theirs: the chip is the bar's full
          // field height, and an outset ring is clipped above and below.
          outlineOffset: sxRem(-2),
        },
      }}
    >
      {quick.label}
      {quick.count !== undefined && (
        <Box
          component="span"
          sx={{
            fontWeight: 400,
            fontVariantNumeric: "tabular-nums",
            color: (theme: Theme) => (active ? "inherit" : toneColor(theme, quick.tone)),
            opacity: active ? 0.75 : 1,
          }}
        >
          {quick.count}
        </Box>
      )}
    </Box>
  );
}

/** The same chip inside "Mais": a toggle row, label and count. */
export function QuickRow({
  quick,
  active,
  onToggle,
  testIdPrefix,
}: {
  quick: QuickFilterConfig;
  active: boolean;
  onToggle: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      component="label"
      data-testid={`${testIdPrefix}-more-quick-${quick.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        pr: 1,
        minHeight: fieldHeight,
        cursor: "pointer",
        fontSize: sxRem(13),
        color: active ? "primary.main" : "text.primary",
      }}
    >
      <Checkbox
        size="small"
        checked={active}
        onChange={onToggle}
        inputProps={{ "aria-label": quick.label }}
      />
      <Box component="span" sx={{ flex: 1 }}>
        {quick.label}
      </Box>
      {quick.count !== undefined && (
        <Box
          component="span"
          sx={{ fontVariantNumeric: "tabular-nums", color: (theme: Theme) => toneColor(theme, quick.tone) }}
        >
          {quick.count}
        </Box>
      )}
    </Box>
  );
}
