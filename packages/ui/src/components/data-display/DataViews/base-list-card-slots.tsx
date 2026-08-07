"use client";

import { Fragment, type ReactNode } from "react";

import { DescriptionItem, type DescriptionItemProps } from "../DescriptionItem";
import { RAIL_GAP_PX } from "./list-card-rails";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

/**
 * WHAT SITS IN EACH RAIL.
 *
 * Split from `base-list-card` at the size gate: that module is the shell, the
 * rails and the states; this is the content of each column.
 */

/** Below this the row drops its middle columns. */
export const META_BREAK = 520;
/** …and below this it leaves the shared rails and goes two-line. */
export const STACK_BREAK = 360;

/** Money and dates line up only if their digits are the same width. */
const TABULAR = { fontVariantNumeric: "tabular-nums" } as const;

const CLAMP = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * Title over subtitle — and, when the row navigates, the anchor that covers it.
 *
 * The link is a real `<a>` stretched by `::after` over the whole card rather
 * than a click handler on a `<div>`. That buys cmd-click, middle-click, "copy
 * link address", the status bar preview and correct tab order, and it stops the
 * buttons elsewhere in the row from being interactive elements nested inside a
 * clickable one.
 */
export function ListCardCaption({
  title,
  subtitle,
  href,
  target,
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  target?: string;
  testId?: string;
}): React.JSX.Element {
  return (
    <Box data-slot="caption" sx={{ minWidth: 0 }}>
      {title != null && (
        <Text variant="heading" size="sm" weight="bold" as="p">
          <Box
            {...(href ? { component: "a", href, target } : { component: "span" })}
            data-testid={testId}
            sx={{
              display: "block",
              lineHeight: 1.2,
              fontSize: "0.9rem",
              color: "inherit",
              textDecoration: "none",
              ...CLAMP,
              ...(href
                ? {
                    "&::after": {
                      content: '""',
                      position: "absolute",
                      inset: 0,
                      // Under the checkbox, drag grip, actions and menu, which
                      // all raise themselves to 1.
                      zIndex: 0,
                    },
                    "&:hover": { textDecoration: "underline" },
                  }
                : {}),
            }}
          >
            {title}
          </Box>
        </Text>
      )}
      {subtitle != null && (
        <Text variant="caption" size="xs" color="secondary" as="p">
          <Box component="span" sx={{ display: "block", ...CLAMP }}>
            {subtitle}
          </Box>
        </Text>
      )}
    </Box>
  );
}

/** One rule between two columns. Shared, so every gap gets the same mark. */
function MetaRule(): React.JSX.Element {
  return (
    <Box
      aria-hidden
      sx={{
        flex: "0 0 auto",
        color: "text.disabled",
        opacity: 0.5,
        userSelect: "none",
        fontSize: "0.875rem",
        // A cancelled row strikes the whole meta cluster, and a struck `|` is a
        // dagger. The rule is punctuation, not data — nothing to void.
        textDecoration: "none",
      }}
    >
      |
    </Box>
  );
}

/**
 * The middle columns: stacked label-over-value pairs, separated by a rule.
 *
 * Stacked rather than side by side because `DATA 05/08/2026` inline spends the
 * horizontal room the value rail needs, and the separator is what stops two
 * adjacent pairs reading as one four-word phrase.
 *
 * EVEN GAPS, NOT EVEN BOXES. The rail takes a share of the row's spare width
 * per pair (see `metaRail`), and the obvious way to spend it — give every pair
 * an equal-width box and centre its content — puts the separator on the BOX
 * boundary, which is only the visual midpoint when both pairs are the same
 * width. They never are: `05/08/2026, 13:45` reaches almost to the edge of its
 * box while `PIX` stops well short of its own, so the rule ends up crowded
 * against the date and adrift from the method.
 *
 * So the pairs are sized to their content and the SPARE space is what gets
 * divided evenly. `space-evenly` gives every gap — including the two either
 * side of each separator — the same width, which puts each rule exactly halfway
 * between the two labels it separates, whatever they happen to say.
 */
export function ListCardMeta({
  meta,
  metaSlot,
  trailingRule,
}: {
  meta?: DescriptionItemProps[];
  metaSlot?: ReactNode;
  /** Close the run with a rule, dividing the last pair from the value. */
  trailingRule?: boolean;
}): React.JSX.Element {
  const items = meta ?? [];
  return (
    <Box
      data-slot="meta"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-evenly",
        // A FLOOR, not the spacing itself: `space-evenly` supplies the rest, and
        // this is only what keeps a rail with no room to spare from running the
        // date straight into the rule.
        gap: 1,
        whiteSpace: "nowrap",
        ...TABULAR,
        // Rung 1 of the ladder.
        [`@container (max-width: ${META_BREAK}px)`]: { display: "none" },
      }}
    >
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          {/* ITS OWN ITEM, not the first child of the pair that follows it.
              Nested inside, the rule travelled with that pair's centred content
              and came to rest nearer one label than the other — a separator
              visibly closer to MÉTODO than to DATA reads as belonging to it. */}
          {index > 0 && <MetaRule />}
          {/* Centred: a stacked pair sitting in its own column reads as one
              unit only when the label is over the value rather than flush left
              of a value shorter than it — `MÉTODO` above `PIX` was visibly
              unhinged from it. Overridable per item. */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              // Sized to the pair, so the gaps either side of it are free space
              // that `space-evenly` can equalise.
              flex: "0 0 auto",
            }}
          >
            <DescriptionItem orientation="vertical" align="center" {...item} />
          </Box>
        </Fragment>
      ))}
      {metaSlot}
      {trailingRule && items.length > 0 && <MetaRule />}
    </Box>
  );
}

/**
 * The value sits flush against the meta rail, with no gap of its own.
 *
 * Its divider is now the LAST ITEM OF THE META CLUSTER, placed by the same
 * `space-evenly` that places the rules between the pairs — so it is equidistant
 * from `PIX` and from `R$ 13,90` for free, which a rule centred in the rail gap
 * could never be: the cluster's content stops well short of the rail's right
 * edge, leaving that rule 150px from the method and 12px from the money.
 *
 * Cancelling this one gap is what makes the two distances equal. Below
 * `META_BREAK` the cluster (and its rule) are gone, so the gap comes back —
 * otherwise the value would sit straight against the title.
 */
const VALUE_FLUSH = {
  marginLeft: `-${RAIL_GAP_PX}px`,
  [`@container (max-width: ${META_BREAK}px)`]: { marginLeft: 0 },
} as const;

/** The value, on its own rail, never truncated and never shunted by the chip. */
function ListCardValue({ value }: { value: ReactNode }): React.JSX.Element {
  return (
    <Text variant="body" size="sm" weight="medium" as="span">
      <Box
        component="span"
        sx={{ fontSize: "0.875rem", whiteSpace: "nowrap", ...TABULAR }}
      >
        {value}
      </Box>
    </Text>
  );
}

/**
 * The actions and the menu, at the end of the row.
 *
 * Actions are revealed on hover and `:focus-within` — always-visible buttons on
 * every row of fifty is a lot of chrome for something used on one of them.
 * `:focus-within` is what keeps them reachable by keyboard, and `visibility`
 * rather than `display` keeps their space reserved so nothing shifts.
 */
function ListCardActions({
  actions,
  alwaysVisible,
  menu,
  testId,
}: {
  actions?: ReactNode;
  alwaysVisible?: boolean;
  menu?: ReactNode;
  testId: (slot: string) => string | undefined;
}): React.JSX.Element | null {
  if (actions == null && menu == null) return null;
  return (
    // z-index 1: above the stretched link, so these stay clickable.
    <Box
      data-slot="actions"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, position: "relative", zIndex: 1 }}
    >
      {actions && (
        <Box
          data-testid={testId("actions")}
          onClick={(event) => event.stopPropagation()}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            ...(alwaysVisible
              ? {}
              : {
                  visibility: "hidden",
                  ".MuiPaper-root:hover &, .MuiPaper-root:focus-within &": {
                    visibility: "visible",
                  },
                }),
          }}
        >
          {actions}
        </Box>
      )}
      {menu && (
        <Box data-testid={testId("menu")} onClick={(event) => event.stopPropagation()}>
          {menu}
        </Box>
      )}
    </Box>
  );
}

/** Value, status and actions — three rails, not one flex run. */
export function ListCardTail({
  value,
  separated,
  status,
  actions,
  actionsAlwaysVisible,
  menu,
  testId,
}: {
  value?: ReactNode;
  /** Whether a meta cluster precedes the value and wants dividing from it. */
  separated?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  menu?: ReactNode;
  testId: (slot: string) => string | undefined;
}): React.JSX.Element {
  return (
    <>
      <Box
        data-slot="value"
        sx={{
          textAlign: "right",
          ...(separated && value != null ? VALUE_FLUSH : {}),
        }}
        data-testid={testId("value")}
      >
        {value != null && <ListCardValue value={value} />}
      </Box>
      <Box
        data-slot="status"
        sx={{ display: "flex", justifyContent: "flex-start" }}
        data-testid={testId("status")}
      >
        {status}
      </Box>
      <ListCardActions
        actions={actions}
        alwaysVisible={actionsAlwaysVisible}
        menu={menu}
        testId={testId}
      />
    </>
  );
}
