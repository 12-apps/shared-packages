/**
 * The block's width, picked by SHAPE rather than by arithmetic (FUT-391).
 *
 * It replaced a `<Select>` reading `6/12 · 1/2`, which leaks the twelve-column
 * grid at the author — a store owner choosing how wide a chart should be does
 * not have a view about twelfths. Four segments, each drawn to the width it
 * sets, say the same thing without the notation.
 *
 * It offers four canonical widths — WHICH four depends on the presentation
 * (FUT-755): a `Número` block is a figure and a caption, so its four run from a
 * sixth to a half, where a chart's run from a third to the full canvas.
 *
 * It does NOT restrict what a block may STORE. `dashboardBlockSchema`
 * deliberately accepts 1..12, and a block already saved at 5 — by a preset, by
 * MCP, or by a future drag-resize — must keep it rather than be silently
 * rewritten the moment its panel is opened. Such a width shows as its own
 * selected segment instead of snapping to a neighbour.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { minSpanForPresentation, REPORT_GRID_COLUMNS, type PresentationShape } from "../layout";
import { CONTROL_RADIUS_PX, SECTION_LABEL_STYLE } from "./lib/report-surface";
import {
  SIZE_TILE_GRID_SX,
  SIZE_TILE_LABEL_SX,
  SIZE_TILE_SX,
} from "./lib/size-picker-tile";

/**
 * Every fraction the twelve-column grid states EXACTLY — and why there is no
 * `2/5` (FUT-755).
 *
 * A width is a number of twelfths, so a fraction is offerable only when it HAS
 * a twelfth: 1/6 = 2, 1/4 = 3, 1/3 = 4, 1/2 = 6, 2/3 = 8. Two fifths is 4.8
 * columns, which this grid cannot draw at all — the nearest, 5/12, is 0.4167,
 * off by 4% — so a segment labelled `2/5` would be a control lying about what
 * it does. The alternative was widening the canvas to a column count divisible
 * by five, which would restate every stored `span` (all of them twelfths),
 * every preset, `spanBasis`'s arithmetic and `responsiveSpan`'s two anchors: a
 * migration of everything already saved, to buy one width. The grid stays at
 * twelve, and `Número` gets the nearest honest smaller pair — `1/6` and `1/4`.
 *
 * The full canvas is `100%` rather than a word, because it is the one option
 * every other label is a fraction OF — and short, which is what lets every tile
 * be the same compact size (see `lib/size-picker-tile`).
 *
 * A width with no exact name falls back to the notation this control otherwise
 * avoids: a stored 5 has to be SHOWN somehow, and `5/12` is at least true.
 */
const SPAN_LABELS: Record<number, string> = {
  2: "1/6",
  3: "1/4",
  4: "1/3",
  6: "1/2",
  8: "2/3",
  12: "100%",
};

function spanLabel(span: number): string {
  return SPAN_LABELS[span] ?? `${span}/${REPORT_GRID_COLUMNS}`;
}

/**
 * The widths worth a segment, decided by what the block IS (FUT-755).
 *
 * A single figure in a third of the canvas is mostly whitespace, so `Número`
 * offers the narrow end — down to a sixth, which is four tiles to a row — and
 * stops at half, past which a KPI block is a lonely number on a banner.
 * Everything else keeps the four widths a chart or a table is read at.
 */
function canonicalWidths(presentation: PresentationShape): number[] {
  return presentation.kind === "kpi" ? [2, 3, 4, 6] : [4, 6, 8, 12];
}

/**
 * The segments to draw: the presentation's canonical four, plus the block's OWN
 * width when it is not one of them — so a KPI stored at 12, by a preset or over
 * MCP or simply before this rule existed, stays visible and selected rather
 * than disappearing from the control that is supposed to represent it.
 */
export function widthSegments(
  span: number,
  presentation: PresentationShape,
): Array<{ span: number; label: string }> {
  const canonical = canonicalWidths(presentation).map((entry) => ({
    span: entry,
    label: spanLabel(entry),
  }));
  if (canonical.some((entry) => entry.span === span)) return canonical;
  return [...canonical, { span, label: spanLabel(span) }].sort((a, b) => a.span - b.span);
}

export function BlockWidthPicker({
  span,
  presentation,
  onChange,
  testId,
}: {
  span: number;
  presentation: PresentationShape;
  onChange: (span: number) => void;
  testId: string;
}): JSX.Element {
  const min = minSpanForPresentation(presentation);
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" color="secondary" as="h3" style={SECTION_LABEL_STYLE}>
        Largura
      </Text>
      <Box data-testid={testId} sx={SIZE_TILE_GRID_SX}>
        {widthSegments(span, presentation).map((segment) => {
          // Below the presentation's floor the rendering is unreadable rather
          // than merely small — a table in a third of the canvas truncates
          // every column. Disabled with the width still shown, so the author
          // sees WHY the option is there and not why it vanished.
          const tooNarrow = segment.span < min;
          return (
            <Button
              key={segment.span}
              variant={segment.span === span ? "solid" : "outline"}
              size="sm"
              disabled={tooNarrow}
              aria-pressed={segment.span === span}
              sx={SIZE_TILE_SX}
              onClick={() => onChange(segment.span)}
              data-testid={`${testId}-${segment.span}`}
            >
              {/* Drawn to scale: the BAR is as wide, relatively, as the block
                  the segment produces. That is the part the notation could not
                  do — and it is the bar that varies now, not the tile, which is
                  what lets the widths be compared at all. */}
              <Box
                sx={{
                  width: `${(segment.span / REPORT_GRID_COLUMNS) * 48}px`,
                  height: 6,
                  // The control radius, not a fourth value: these four bars
                  // were the last 4px in the editor subtree, against the two
                  // `visual-pass.md` §Components allows. A 6px-tall bar reads
                  // the same either way — the point is that nothing in here
                  // rounds by a number nobody chose.
                  borderRadius: `${CONTROL_RADIUS_PX}px`,
                  bgcolor: "currentColor",
                  opacity: tooNarrow ? 0.35 : 1,
                }}
              />
              <Box component="span" sx={SIZE_TILE_LABEL_SX}>
                {segment.label}
              </Box>
            </Button>
          );
        })}
      </Box>
    </Stack>
  );
}
