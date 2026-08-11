/**
 * The block's height, picked the way its width is (FUT-755).
 *
 * `Largura` had no counterpart: a block was always exactly as tall as whatever
 * it rendered, so two blocks side by side ended at different places and a KPI
 * beside a chart left a ragged row. `Altura` is the other half of the same
 * control — same section, same segmented idiom, same "drawn to the size it
 * sets" bar — and it means a TIER, which `layout.ts` (`blockHeightCss`) turns
 * into a clamped share of the window rather than a pixel count, so the three
 * stay far enough apart to tell apart on a laptop and on a 4K panel alike.
 *
 * **`Auto` is a real option, and it is the default.** A block that has never
 * been given a height stores none, and stores none after this control is
 * rendered too — the picker starts on `Auto` and only writes a height when one
 * is chosen. That is what keeps every saved report measuring exactly what it
 * measures today, and it is why the value is `number | undefined` rather than a
 * number with 1 standing in for "auto".
 *
 * Unlike the width control, EVERY option here is always available. A narrow
 * block truncates, so widths need a floor per presentation; a short block does
 * not, and each tier is tall enough for any rendering to read at. A tier that
 * can never be picked makes the whole set look broken, and `Baixa` used to be
 * exactly that — refused on anything but a `Número`, because a tier was 140px.
 * Its floor is 260px now (`layout.ts`), which is a chart with real bars and a
 * labelled axis, so nothing is refused any more.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { BLOCK_HEIGHT_MAX } from "../layout";
import { CONTROL_RADIUS_PX, SECTION_LABEL_STYLE } from "./lib/report-surface";
import {
  SIZE_TILE_BAR_MAX_PX,
  SIZE_TILE_GRID_SX,
  SIZE_TILE_LABEL_SX,
  SIZE_TILE_SX,
} from "./lib/size-picker-tile";

/** One segment: `height: undefined` is the content-height default. */
interface HeightSegment {
  height: number | undefined;
  label: string;
}

/**
 * The four segments, in the register `Largura` uses: a word for the shape,
 * never a measurement. A store owner deciding how tall a chart should be does
 * not have a view about pixels or viewport units, exactly as they do not have
 * one about twelfths.
 *
 * Four is the whole set — there is no "own segment" case here, unlike the width
 * control. A width may be stored at any of twelve values, so the picker has to
 * be able to show one it does not offer; a height IS the tier (the schema
 * accepts 1..3 and `clampBlockHeight` guarantees it), so every storable value
 * already has a segment.
 */
export function heightSegments(): HeightSegment[] {
  return [
    { height: undefined, label: "Auto" },
    { height: 1, label: "Baixa" },
    { height: 2, label: "Média" },
    { height: 3, label: "Alta" },
  ];
}

/** The id a segment answers to — `…-auto` for the one with no number. */
function segmentTestId(testId: string, height: number | undefined): string {
  return `${testId}-${height ?? "auto"}`;
}

/**
 * The bar, drawn to the height it sets — the same trick the width control uses
 * on the other axis, and the part a word label cannot do on its own. `Auto`
 * draws the shortest bar because a block with no stored height is as tall as
 * its content, which is usually the least of the four.
 *
 * It is scaled against {@link SIZE_TILE_BAR_MAX_PX} rather than a number of its
 * own, because the TILE is a fixed size: a bar free to grow with the tier would
 * push its own label out of the box.
 */
function segmentBarPx(height: number | undefined): string {
  const tier = height ?? 1;
  return `${(tier / BLOCK_HEIGHT_MAX) * (SIZE_TILE_BAR_MAX_PX - 4) + 4}px`;
}

export function BlockHeightPicker({
  height,
  onChange,
  testId,
}: {
  height: number | undefined;
  onChange: (height: number | undefined) => void;
  testId: string;
}): JSX.Element {
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" color="secondary" as="h3" style={SECTION_LABEL_STYLE}>
        Altura
      </Text>
      <Box data-testid={testId} sx={SIZE_TILE_GRID_SX}>
        {heightSegments().map((segment) => (
          <Button
            key={segmentTestId(testId, segment.height)}
            variant={segment.height === height ? "solid" : "outline"}
            size="sm"
            aria-pressed={segment.height === height}
            sx={SIZE_TILE_SX}
            onClick={() => onChange(segment.height)}
            data-testid={segmentTestId(testId, segment.height)}
          >
            <Box
              sx={{
                width: 6,
                height: segmentBarPx(segment.height),
                // The control radius, not a fourth value — the same rule
                // the width control's bars follow.
                borderRadius: `${CONTROL_RADIUS_PX}px`,
                bgcolor: "currentColor",
              }}
            />
            <Box component="span" sx={SIZE_TILE_LABEL_SX}>
              {segment.label}
            </Box>
          </Button>
        ))}
      </Box>
    </Stack>
  );
}
