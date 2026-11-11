"use client";

import { createContext, useContext, type JSX, type ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { sxRem } from "@12-apps/ui/tokens";
import { Text } from "@12-apps/ui/typography/Text";

import type { ComboRequirement } from "../engine/types";

import { toBasisPoints, toCents, type WireTargetGroup } from "./api";
import type { DiscountsWebCopy } from "./copy";
import { comboPreviewOf, type ComboPreview, type ComboRewardValue } from "./combo-preview";
import { comboPreviewLines, type ComboPreviewLayout } from "./combo-preview-lines";
import { comboRewardOf } from "./form-kind";
import type { DiscountsFormatters } from "./format";

/**
 * "Como fica no carrinho" on screen (FUT-4417), and where it sits.
 *
 * Under the reward's field on a phone or a narrow form; in its own column
 * beside the form when the form has the room, as the approved prototype draws
 * it on a computer. What decides is the FORM's own width, measured the way
 * Tipo cards measure it, because the form also lives in a modal narrower
 * than the screen. In the wide stacked modal the screens open it in
 * (`DiscountDialog`), a 1280 window gives the form well over the threshold;
 * a tablet's or a phone's does not, and the preview sits under the field.
 */

/** The side column: about 380 px beside the steps, `gap: 3` (the approved prototype, FUT-4475). */
const ASIDE_PX = 380;
const ASIDE_GAP_PX = 24;

/**
 * The narrowest form that takes the side column: one whose steps column still
 * holds the four Tipo cards on one row (`rowMinPx`, measured by `TipoCards`).
 * A column that pushed Tipo into a single column would trade the question the
 * operator reads first for a box beside it — the column has room only when
 * nothing else pays for it.
 */
export function asideMinPx(rowMinPx: number): number {
  return Math.ceil(rowMinPx + ASIDE_GAP_PX + ASIDE_PX);
}

/** What the preview reads that is not a form value. */
interface PreviewInputs {
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
  groups: readonly WireTargetGroup[];
  slots: readonly ComboRequirement[];
}

/**
 * The preview, worked out ONCE per render of the layout and handed down: the
 * inline box under the reward's field reads it from here rather than summing
 * the combo a second time.
 */
interface PreviewWorld extends PreviewInputs {
  layout: ComboPreviewLayout;
  reward: ComboRewardValue;
  preview: ComboPreview | null;
}

const PreviewContext = createContext<PreviewWorld | null>(null);

/** The reward the form currently describes, as numbers. */
function rewardFrom(
  values: Record<string, string>,
  formatters: DiscountsFormatters,
): ComboRewardValue {
  return {
    type: comboRewardOf({ type: values.comboReward ?? "" }),
    percentOffBp: toBasisPoints(values.percentOff ?? "", formatters),
    amountOffCents: toCents(values.amountOff ?? "", formatters),
    bundlePriceCents: toCents(values.bundlePrice ?? "", formatters),
  };
}

/** The preview the form currently describes, or null when there is nothing honest to sum. */
function useComboPreview(world: PreviewInputs): {
  reward: ComboRewardValue;
  preview: ComboPreview | null;
} {
  const { values } = useFormContext();
  const reward = rewardFrom(values, world.formatters);
  const preview =
    values.kind === "COMBO" ? comboPreviewOf(world.slots, world.groups, reward) : null;
  return { reward, preview };
}

function PreviewBox({ world }: { world: PreviewWorld }): JSX.Element | null {
  const { reward, preview } = world;
  if (preview === null) return null;
  const lines = comboPreviewLines(preview, reward, world.layout, world.copy, world.formatters);
  const aside = world.layout === "aside";
  return (
    <Alert variant="info" showIcon={false} animate={false} data-testid="combo-cart-preview">
      <Stack spacing={aside ? 1 : 0.5}>
        {/* A small label over the figures, as the prototype draws it — not the
            Alert's own title, which is larger than the lines it heads. */}
        <Text as="p" variant="caption" weight="semibold" data-testid="combo-cart-preview-heading">
          {world.copy.comboRewards.preview.title}
        </Text>
        <Text variant="body" size="sm" data-testid="combo-cart-preview-items">
          {lines.items}
        </Text>
        {lines.pays !== null && (
          <Text
            variant={aside ? "heading" : "body"}
            {...(aside ? {} : { size: "sm" as const })}
            data-testid="combo-cart-preview-pays"
          >
            {lines.pays}
          </Text>
        )}
        {lines.examples !== null && (
          <Text variant="caption" data-testid="combo-cart-preview-examples">
            {lines.examples}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}

/** The preview under the reward's field — rendered only when the form is narrow. */
export function InlineComboCartPreview(): JSX.Element | null {
  const world = useContext(PreviewContext);
  if (world === null || world.layout !== "inline") return null;
  return <PreviewBox world={world} />;
}

/**
 * The form's body, with its side column when the form is wide enough (`wide`,
 * decided by the step form from its measured width and `asideMinPx`): the
 * "Resumo" (`aside`) for every kind, then the cart preview for a combo with a
 * priced group. Otherwise the body alone, and the reward field places the
 * preview under itself. The column sticks below the form's sticky chrome
 * (`stickyTop`).
 */
export function ComboPreviewLayout({
  copy,
  formatters,
  groups,
  slots,
  wide,
  aside,
  stickyTop = 0,
  children,
}: PreviewInputs & { wide: boolean; aside?: ReactNode; stickyTop?: number; children: ReactNode }): JSX.Element {
  const { reward, preview } = useComboPreview({ copy, formatters, groups, slots });
  const layout: ComboPreviewLayout = wide ? "aside" : "inline";
  const world: PreviewWorld = { layout, copy, formatters, groups, slots, reward, preview };
  return (
    <PreviewContext.Provider value={world}>
      <Box
        data-testid="combo-preview-layout"
        data-layout={layout}
        sx={
          wide
            ? {
                display: "grid",
                gridTemplateColumns: (theme) => `minmax(0, 1fr) ${sxRem(ASIDE_PX)(theme)}`,
                gap: 3,
                alignItems: "start",
              }
            : { minWidth: 0 }
        }
      >
        <Box sx={{ minWidth: 0 }}>{children}</Box>
        {wide && (
          <Stack spacing={1.5} data-testid="discount-form-aside" sx={{ position: "sticky", top: stickyTop }}>
            {aside}
            <PreviewBox world={world} />
          </Stack>
        )}
      </Box>
    </PreviewContext.Provider>
  );
}
