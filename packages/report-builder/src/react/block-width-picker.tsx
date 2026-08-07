/**
 * The block's width, picked by SHAPE rather than by arithmetic (FUT-391).
 *
 * It replaced a `<Select>` reading `6/12 · 1/2`, which leaks the twelve-column
 * grid at the author — a store owner choosing how wide a chart should be does
 * not have a view about twelfths. Four segments, each drawn to the width it
 * sets, say the same thing without the notation.
 *
 * It offers four canonical widths but does NOT restrict what a block may
 * STORE. `dashboardBlockSchema` deliberately accepts 1..12, and a block already
 * saved at 5 — by a preset, by MCP, or by a future drag-resize — must keep it
 * rather than be silently rewritten the moment its panel is opened. Such a
 * width shows as its own selected segment instead of snapping to a neighbour.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { minSpanForPresentation, REPORT_GRID_COLUMNS, type PresentationShape } from "../layout";

/** The four widths worth a segment; anything else is expressible but not offered. */
const CANONICAL_WIDTHS = [
  { span: 4, label: "1/3" },
  { span: 6, label: "1/2" },
  { span: 8, label: "2/3" },
  { span: 12, label: "Inteira" },
] as const;

/**
 * The segments to draw: the canonical four, plus the block's OWN width when it
 * is not one of them — so a stored 5 stays visible and selectable rather than
 * disappearing from the control that is supposed to represent it.
 */
export function widthSegments(span: number): Array<{ span: number; label: string }> {
  const canonical = CANONICAL_WIDTHS.map((entry) => ({ span: entry.span, label: entry.label }));
  if (canonical.some((entry) => entry.span === span)) return canonical;
  return [...canonical, { span, label: `${span}/12` }].sort((a, b) => a.span - b.span);
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
      <Text variant="heading" size="xs" as="h3">
        Largura
      </Text>
      <Stack direction="row" spacing={1} data-testid={testId} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        {widthSegments(span).map((segment) => {
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
              onClick={() => onChange(segment.span)}
              data-testid={`${testId}-${segment.span}`}
            >
              <Stack spacing={0.5} sx={{ alignItems: "center" }}>
                {/* Drawn to scale: the segment is as wide, relatively, as the
                    block it produces. That is the part the notation could not
                    do. */}
                <Box
                  sx={{
                    width: `${(segment.span / REPORT_GRID_COLUMNS) * 48}px`,
                    height: 6,
                    borderRadius: 1,
                    bgcolor: "currentColor",
                    opacity: tooNarrow ? 0.35 : 1,
                  }}
                />
                <span>{segment.label}</span>
              </Stack>
            </Button>
          );
        })}
      </Stack>
    </Stack>
  );
}
