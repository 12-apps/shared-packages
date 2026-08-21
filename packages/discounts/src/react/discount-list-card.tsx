"use client";

import type { JSX } from "react";

import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";

import {
  BodyHeading,
  DetailColumns,
  Fact,
  TagList,
  type KindListCardProps,
} from "@12-apps/ui/data-display/CardKit";
import { Chip } from "@12-apps/ui/data-display/Chip";
import {
  BaseListCard,
  type ListCardCellConfig,
} from "@12-apps/ui/data-display/DataViews";

import type { WireTarget, WireTargetGroup } from "./api";
import { fill, type DiscountsWebCopy } from "./copy";
import { DiscountActionsMenu, type DiscountActionsMenuProps } from "./discount-actions-menu";
import { EMPTY, type DiscountsFormatters } from "./format";
import type { DiscountListItem } from "./row";

/**
 * One rule as a full-width row, with an expanded body.
 *
 * The reason this layout exists at all is the target list: a `string[]` has no
 * honest table cell. Truncated to "3 items" it says nothing; printed in full it
 * destroys the column. In an expanded body it simply wraps.
 */

/** `RUNNING` is the only good one; the other two are why a rule is not firing. */
const WINDOW_COLOR: Record<string, "success" | "info" | "neutral"> = {
  RUNNING: "success",
  SCHEDULED: "info",
  ENDED: "neutral",
};

/**
 * Target ids resolved to names, falling back to the raw ID.
 *
 * The id IS the honest fallback. A rule can name a row that has since been
 * deleted, and dropping it would show a scope of "Category" over an empty list
 * — which reads as "applies to nothing" when it in fact still applies to
 * whatever that id is.
 */
function targetNames(
  ids: readonly string[],
  groups: readonly WireTargetGroup[] | undefined,
  targetType: string,
): string[] {
  const options: WireTarget[] =
    groups?.find((group) => group.targetType === targetType)?.targets ?? [];
  if (options.length === 0) return [...ids];
  return ids.map((id) => options.find((option) => option.id === id)?.name ?? id);
}

/** How many rows this rule is pointed at, given its scope. */
function targetCount(row: DiscountListItem): number {
  if (row.scope === "CATEGORY") return row.categoryIds.length;
  if (row.scope === "ITEM") return row.menuItemIds.length;
  return 0;
}

/**
 * Declared HERE and handed to the list's own config, and kept on the card too.
 *
 * Not redundancy. Inside a list group the group's config wins and the card's is
 * ignored — that is what makes the columns line up by construction. Outside
 * one, the card's own config is the only thing it has: a standalone row with
 * neither falls back to the named slots and renders no summary at all.
 */
export function discountCells(copy: DiscountsWebCopy): ListCardCellConfig<DiscountListItem>[] {
  return [
    {
      id: "discount",
      primary: (row) => row.name,
      secondary: (row) =>
        row.code == null
          ? (copy.labels.trigger[row.trigger as keyof typeof copy.labels.trigger] ?? row.trigger)
          : fill(copy.card.withCode, { code: row.code }),
    },
    {
      id: "where",
      primary: (row) => copy.labels.scope[row.scope as keyof typeof copy.labels.scope] ?? row.scope,
      secondary: (row) => {
        if (row.scope === "ORDER") return copy.card.wholeOrder;
        const count = targetCount(row);
        return count === 1 ? copy.card.oneTarget : fill(copy.card.manyTargets, { count });
      },
    },
    {
      id: "window",
      primary: (row) =>
        copy.labels.window[row.windowState] ?? row.windowState,
      secondary: (row) => row.windowLabel,
    },
    {
      id: "value",
      align: "end",
      width: "max-content",
      strong: true,
      primary: (row) => row.valueLabel,
    },
  ];
}

/** The rule side: when it fires, how often, and whether it is running. */
function RuleFacts({
  row,
  copy,
  formatters,
}: {
  row: DiscountListItem;
  copy: DiscountsWebCopy;
  formatters: DiscountsFormatters;
}): JSX.Element {
  const cap = row.usageLimit === null ? copy.card.unlimited : String(row.usageLimit);
  return (
    <>
      <BodyHeading>{copy.card.ruleHeading}</BodyHeading>
      <Fact
        label={copy.screen.columns.window}
        value={
          <Chip
            label={copy.labels.window[row.windowState] ?? row.windowState}
            size="sm"
            variant={row.windowState === "RUNNING" ? "filled" : "outlined"}
            color={WINDOW_COLOR[row.windowState] ?? "neutral"}
          />
        }
      />
      <Fact label={copy.card.usage} value={`${row.usageCount} / ${cap}`} />
      <Fact label={copy.card.minSubtotal} value={formatters.money(row.minSubtotalCents)} />
      <Fact
        label={copy.card.perBuyerLimit}
        value={row.perBuyerLimit === null ? copy.card.unlimited : String(row.perBuyerLimit)}
      />
      <Fact label={copy.screen.columns.code} value={row.code ?? EMPTY} />
    </>
  );
}

/** The targets side: what it actually covers. */
function TargetFacts({
  row,
  copy,
  groups,
}: {
  row: DiscountListItem;
  copy: DiscountsWebCopy;
  groups: readonly WireTargetGroup[] | undefined;
}): JSX.Element {
  const ids = row.scope === "CATEGORY" ? row.categoryIds : row.menuItemIds;
  const names =
    row.scope === "ORDER" ? [] : targetNames(ids, groups, row.scope === "CATEGORY" ? "CATEGORY" : "ITEM");
  return (
    <>
      <BodyHeading>{copy.card.targetsHeading}</BodyHeading>
      {row.scope === "ORDER" ? (
        <Fact label={copy.screen.columns.scope} value={copy.card.wholeOrder} />
      ) : (
        <TagList items={names} empty={copy.card.noTargets} />
      )}
    </>
  );
}

type DiscountListCardProps = KindListCardProps &
  Omit<DiscountActionsMenuProps, "row"> & {
    row: DiscountListItem;
    copy: DiscountsWebCopy;
  };

export function DiscountListCard({
  row,
  selection,
  copy,
  ...menu
}: DiscountListCardProps): JSX.Element {
  return (
    <BaseListCard
      testId={`discount-list-card-${row.id}`}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
      cells={discountCells(copy) as readonly ListCardCellConfig<never>[]}
      row={row}
      leading={<LocalOfferOutlinedIcon sx={{ fontSize: 22, opacity: 0.5 }} />}
      menu={<DiscountActionsMenu row={row} copy={copy} {...menu} />}
    >
      <DetailColumns
        left={<RuleFacts row={row} copy={copy} formatters={menu.formatters} />}
        right={<TargetFacts row={row} copy={copy} groups={menu.groups} />}
      />
    </BaseListCard>
  );
}
