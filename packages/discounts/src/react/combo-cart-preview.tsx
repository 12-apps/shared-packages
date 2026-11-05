"use client";

import { createContext, useContext, useRef, type JSX, type ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ComboRequirement } from "../engine/types";

import { toBasisPoints, toCents, type WireTargetGroup } from "./api";
import type { DiscountsWebCopy } from "./copy";
import { comboPreviewOf, type ComboRewardValue } from "./combo-preview";
import { comboPreviewLines, type ComboPreviewLayout } from "./combo-preview-lines";
import { comboRewardOf } from "./form-kind";
import type { DiscountsFormatters } from "./format";
import { KIND_TOGGLE_MIN_PX, useElementWidth } from "./kind-field";

/**
 * "Como fica no carrinho" on screen (FUT-4417), and where it sits.
 *
 * Under the reward's field on a phone or a narrow form; in its own column
 * beside the form when the form has the room, as the approved prototype draws
 * it on a computer. What decides is the FORM's own width, measured the way
 * `KindField` measures it, because the form also lives in a dialog narrower
 * than the screen.
 */

/** The side column's share and gap: `minmax(0, 3fr) minmax(0, 2fr)`, `gap: 3`. */
const ASIDE_GAP_PX = 24;
const FORM_SHARE = 3 / 5;

/**
 * The narrowest form that takes the side column: one whose left column still
 * holds the kind question as a toggle (`KIND_TOGGLE_MIN_PX`). A column that
 * squeezed it into a select would trade a control the operator already knows
 * for a box of text — the preview has room only when nothing else pays for it.
 */
export const PREVIEW_ASIDE_MIN_PX = Math.ceil(KIND_TOGGLE_MIN_PX / FORM_SHARE + ASIDE_GAP_PX);

/** What the preview needs that is not a form value, and where it was placed. */
interface PreviewWorld {
  layout: ComboPreviewLayout;
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
  groups: readonly WireTargetGroup[];
  slots: readonly ComboRequirement[];
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
function useComboPreview(world: Omit<PreviewWorld, "layout">) {
  const { values } = useFormContext();
  const reward = rewardFrom(values, world.formatters);
  const preview = values.kind === "COMBO" ? comboPreviewOf(world.slots, world.groups, reward) : null;
  return { reward, preview };
}

function PreviewBox({ world }: { world: PreviewWorld }): JSX.Element | null {
  const { reward, preview } = useComboPreview(world);
  if (preview === null) return null;
  const lines = comboPreviewLines(preview, reward, world.layout, world.copy, world.formatters);
  const aside = world.layout === "aside";
  return (
    <Alert
      variant="info"
      showIcon={false}
      animate={false}
      title={world.copy.comboRewards.preview.title}
      data-testid="combo-cart-preview"
    >
      <Stack spacing={aside ? 1 : 0.5}>
        <Text variant="body" data-testid="combo-cart-preview-items">
          {lines.items}
        </Text>
        {lines.pays !== null && (
          <Text variant={aside ? "heading" : "body"} data-testid="combo-cart-preview-pays">
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
 * The form's body, with the preview's column beside it when a combo is being
 * built and the form is wide enough; otherwise the body alone, as it always
 * was, and the reward field places the preview under itself.
 */
export function ComboPreviewLayout({
  copy,
  formatters,
  groups,
  slots,
  children,
}: Omit<PreviewWorld, "layout"> & { children: ReactNode }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  // The column exists only while there is a preview to put in it: an empty
  // column beside a combo with no priced group yet is empty space, and the form
  // would be squeezed for nothing.
  const { preview } = useComboPreview({ copy, formatters, groups, slots });
  const layout: ComboPreviewLayout =
    preview !== null && width !== null && width >= PREVIEW_ASIDE_MIN_PX ? "aside" : "inline";
  const world: PreviewWorld = { layout, copy, formatters, groups, slots };
  return (
    <PreviewContext.Provider value={world}>
      <Box
        ref={box}
        data-testid="combo-preview-layout"
        data-layout={layout}
        sx={
          layout === "aside"
            ? {
                display: "grid",
                gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
                gap: 3,
                alignItems: "start",
              }
            : { minWidth: 0 }
        }
      >
        <Box sx={{ minWidth: 0 }}>{children}</Box>
        {layout === "aside" && <PreviewBox world={world} />}
      </Box>
    </PreviewContext.Provider>
  );
}
