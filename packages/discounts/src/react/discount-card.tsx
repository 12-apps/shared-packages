"use client";

import type { JSX } from "react";

import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";

import type { KindCardProps } from "@12-apps/ui/data-display/CardKit";
import { BaseCard } from "@12-apps/ui/data-display/DataViews";
import { Chip } from "@12-apps/ui/data-display/Chip";
import { Box } from "@12-apps/ui/mui/Box";

import type { DiscountsWebCopy } from "./copy";
import { DiscountActionsMenu, type DiscountActionsMenuProps } from "./discount-actions-menu";
import type { DiscountListItem } from "./row";

/**
 * One rule as a tile for the grid's card layout.
 *
 * The subtitle carries the two numbers an operator scans a promotions board
 * for: what it takes off, and how long it runs. The chips carry the two facts
 * that decide WHERE and WHEN it fires. "Paused" is shown only when true —
 * a card shouting "Active" on every tile would make the one paused promotion
 * harder to spot, not easier.
 */

/** The semantic colour a scope's chip carries. Not copy: it is a token. */
const SCOPE_COLOR: Record<string, "neutral" | "warning" | "success" | "info"> = {
  ORDER: "neutral",
  CATEGORY: "warning",
  ITEM: "success",
  COMBO: "info",
};

const TRIGGER_COLOR: Record<string, "success" | "info"> = {
  AUTOMATIC: "success",
  CODE: "info",
};

type DiscountCardProps = KindCardProps &
  Omit<DiscountActionsMenuProps, "row"> & { row: DiscountListItem };

export function DiscountCard({
  row,
  selection,
  aspectRatio,
  copy,
  ...menu
}: DiscountCardProps & { copy: DiscountsWebCopy }): JSX.Element {
  const scopeLabel = copy.labels.scope[row.scope as keyof typeof copy.labels.scope] ?? row.scope;
  const triggerLabel =
    copy.labels.trigger[row.trigger as keyof typeof copy.labels.trigger] ?? row.trigger;
  return (
    <BaseCard
      aspectRatio={aspectRatio ?? "4:3"}
      scale={selection.scale}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
      testId={`discount-card-${row.id}`}
      title={row.name}
      subtitle={`${row.valueLabel} · ${row.windowLabel}`}
      imageFallback={<LocalOfferOutlinedIcon sx={{ fontSize: 40, opacity: 0.35 }} />}
      menu={<DiscountActionsMenu row={row} copy={copy} {...menu} />}
    >
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        <Chip
          label={scopeLabel}
          size="sm"
          variant="filled"
          color={SCOPE_COLOR[row.scope] ?? "neutral"}
          dataTestId={`discount-card-scope-${row.id}`}
        />
        <Chip
          // A coupon identifies itself; the word "code" beside a code says less.
          label={row.trigger === "CODE" ? (row.code ?? triggerLabel) : triggerLabel}
          size="sm"
          variant="outlined"
          color={TRIGGER_COLOR[row.trigger] ?? "neutral"}
          dataTestId={`discount-card-trigger-${row.id}`}
        />
        {!row.active && (
          <Chip
            label={copy.card.paused}
            size="sm"
            variant="outlined"
            color="neutral"
            dataTestId={`discount-card-paused-${row.id}`}
          />
        )}
      </Box>
    </BaseCard>
  );
}
