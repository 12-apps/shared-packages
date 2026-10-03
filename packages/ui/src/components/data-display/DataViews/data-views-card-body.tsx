"use client";

import { Box } from "../../../mui/Box";

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
  dataTestId?: string;
  emptyState?: React.ReactNode;
}

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
        return (
          <Box key={id}>
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
