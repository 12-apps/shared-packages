"use client";

import { Box } from "../../../mui/Box";

/**
 * Miniature previews of what a layout or a density setting DOES.
 *
 * "Baixa / Média / Alta" tells an operator nothing until they try it, and
 * "Grade" vs "Lista" is only obvious to whoever named them. A glyph that draws
 * three tight rows, or three loose ones, or a grid of blocks, answers the
 * question before the click — so the picker is read once instead of cycled
 * through.
 *
 * Deliberately CSS boxes rather than icons: the point is to show spacing and
 * proportion, which is exactly what an icon font flattens away.
 */

/** The glyph's own footprint, so every tile in a picker lines up. */
const FRAME = { width: 32, height: 24, display: "flex" } as const;

/** Active tiles use the accent; the rest stay muted so the choice reads at a glance. */
function barColor(active: boolean): string {
  return active ? "primary.main" : "action.disabled";
}

/** Three rows at a given gap — the density preview for the table and list. */
export function RowsGlyph({ gap, active }: { gap: number; active: boolean }): React.JSX.Element {
  return (
    <Box sx={{ ...FRAME, flexDirection: "column", justifyContent: "center", gap: `${gap}px` }}>
      {[0, 1, 2].map((index) => (
        <Box key={index} sx={{ height: 2, width: "100%", borderRadius: 1, bgcolor: barColor(active) }} />
      ))}
    </Box>
  );
}

/** A dense block grid — the table layout. */
export function TableGlyph({ active }: { active: boolean }): React.JSX.Element {
  return (
    <Box sx={{ ...FRAME, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px" }}>
      {Array.from({ length: 9 }).map((_, index) => (
        <Box
          key={index}
          sx={{ borderRadius: 0.5, bgcolor: barColor(active), opacity: index < 3 ? 1 : 0.55 }}
        />
      ))}
    </Box>
  );
}

/** Full-width rows each carrying a leading mark — the list layout. */
export function ListGlyph({ active }: { active: boolean }): React.JSX.Element {
  return (
    <Box sx={{ ...FRAME, flexDirection: "column", justifyContent: "center", gap: "4px" }}>
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{
            height: 5,
            width: "100%",
            borderRadius: 0.5,
            bgcolor: barColor(active),
            opacity: 0.7,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Box sx={{ ml: "2px", height: 3, width: 3, borderRadius: "50%", bgcolor: "background.paper" }} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * A grid of blocks — the cards layout, and ALSO the cards density preview: `n`
 * is how many fit per row, so "Muitos / Médio / Poucos" is shown rather than
 * described.
 */
export function GridGlyph({ n = 3, active }: { n?: number; active: boolean }): React.JSX.Element {
  return (
    <Box sx={{ ...FRAME, display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: "2px" }}>
      {Array.from({ length: n * 2 }).map((_, index) => (
        <Box key={index} sx={{ borderRadius: 0.5, bgcolor: barColor(active) }} />
      ))}
    </Box>
  );
}

/** Three columns of decreasing height — the board. */
export function BoardGlyph({ active }: { active: boolean }): React.JSX.Element {
  return (
    <Box sx={{ ...FRAME, gap: "2px" }}>
      {[3, 2, 1].map((count, column) => (
        <Box key={column} sx={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
          {Array.from({ length: count }).map((_, index) => (
            <Box key={index} sx={{ height: 5, borderRadius: 0.5, bgcolor: barColor(active) }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
