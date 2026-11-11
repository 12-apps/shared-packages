"use client";

import { Box } from "../../../mui/Box";
import { PinnedRowLabel, pinnedRowTint } from "../DataGrid/DataGrid.pinned";

import { cardGridTracks } from "./data-views-grid-helpers";
import type { DataViewCardSelection } from "./data-views-types";

/* ── Body (cards) — split out of `data-views-grid-bodies` for its line budget ── */

interface CardBodyProps<T extends Record<string, unknown>> {
  rows: T[];
  renderCard: (row: T, selection: DataViewCardSelection) => React.ReactNode;
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  /** Absent on a grid that is not selectable: the card is handed no toggle. */
  onToggleId?: (id: string | number) => void;
  /** The width each card asks for; `auto-fill` turns it into a column count. */
  targetCardWidth: number;
  /** Content scale (padding + type) handed to each card, from the zoom slider. */
  cardScale: number;
  /** The pinned row (FUT-4745): its card is tinted success and labelled. */
  pinnedRow?: T;
  /** Screen-reader text for the pinned card. */
  pinnedRowLabel?: string;
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

/**
 * The pinned card's wrapper: the success tint laid OVER the entity's card, since
 * the card paints its own surface and would hide a background behind it. The
 * veil takes no pointer events, so the card stays fully interactive.
 */
const PINNED_CARD = {
  "data-pinned": true,
  sx: {
    position: "relative",
    "&::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: 1,
      pointerEvents: "none",
      backgroundColor: pinnedRowTint,
    },
  },
} as const;

/**
 * The "Grade" layout: the filtered/sorted rows rendered as an auto-filling grid
 * of entity-supplied cards. Reuses `rows` (= `c.matched`), so search/filter/sort
 * apply; the column width comes from the zoom slider, and each card is handed its
 * selection state so it can drive its own checkbox (BaseCard) — the same
 * selection model as the table. On a grid that is not selectable the toggle is
 * left out, which is what hides the card's checkbox.
 */
export function CardBody<T extends Record<string, unknown>>({
  rows,
  renderCard,
  getRowId,
  selectedIds,
  onToggleId,
  targetCardWidth,
  cardScale,
  pinnedRow,
  pinnedRowLabel,
  dataTestId,
  emptyState,
}: CardBodyProps<T>): React.JSX.Element {
  if (rows.length === 0) {
    return <Box sx={{ mt: 1.5 }}>{emptyState}</Box>;
  }
  return (
    <Box
      sx={{
        mt: 1.5,
        display: "grid",
        // Fixed inter-card gap — deliberately NOT scaled by the zoom slider, so
        // only the cards grow while the space between them stays constant.
        gap: 1.5,
        ...cardGridTracks(targetCardWidth),
      }}
      data-testid={dataTestId ? `${dataTestId}-cards` : "data-views-cards"}
    >
      {rows.map((row) => {
        const id = getRowId(row);
        const pinned = pinnedRow !== undefined && row === pinnedRow;
        return (
          <Box key={id} {...(pinned ? PINNED_CARD : {})}>
            {pinned ? <PinnedRowLabel label={pinnedRowLabel} /> : null}
            {renderCard(row, {
              selected: selectedIds.has(id),
              onToggleSelect: onToggleId && (() => onToggleId(id)),
              scale: cardScale,
            })}
          </Box>
        );
      })}
    </Box>
  );
}
