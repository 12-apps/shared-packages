"use client";

import { type ReactNode } from "react";

import { DescriptionItem, type DescriptionItemProps } from "../DescriptionItem";
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
  scale,
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  target?: string;
  scale: number;
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
              fontSize: `${0.9 * scale}rem`,
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

/**
 * The middle columns: stacked label-over-value pairs, separated by a rule.
 *
 * Stacked rather than side by side because `DATA 05/08/2026` inline spends the
 * horizontal room the value rail needs, and the separator is what stops two
 * adjacent pairs reading as one four-word phrase.
 */
export function ListCardMeta({
  meta,
  metaSlot,
}: {
  meta?: DescriptionItemProps[];
  metaSlot?: ReactNode;
}): React.JSX.Element {
  const items = meta ?? [];
  return (
    <Box
      data-slot="meta"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        whiteSpace: "nowrap",
        ...TABULAR,
        // Rung 1 of the ladder.
        [`@container (max-width: ${META_BREAK}px)`]: { display: "none" },
      }}
    >
      {items.map((item, index) => (
        <Box key={`${item.label}-${index}`} sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {index > 0 && (
            <Box
              aria-hidden
              sx={{ color: "text.disabled", opacity: 0.5, userSelect: "none", fontSize: "0.875rem" }}
            >
              |
            </Box>
          )}
          {/* Centred: a stacked pair sitting in its own column reads as one
              unit only when the label is over the value rather than flush left
              of a value shorter than it — `MÉTODO` above `PIX` was visibly
              unhinged from it. Overridable per item. */}
          <DescriptionItem orientation="vertical" align="center" {...item} />
        </Box>
      ))}
      {metaSlot}
    </Box>
  );
}

/** The value, on its own rail, never truncated and never shunted by the chip. */
function ListCardValue({ value, scale }: { value: ReactNode; scale: number }): React.JSX.Element {
  return (
    <Text variant="body" size="sm" weight="medium" as="span">
      <Box
        component="span"
        sx={{ fontSize: `${0.875 * scale}rem`, whiteSpace: "nowrap", ...TABULAR }}
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
  status,
  actions,
  actionsAlwaysVisible,
  menu,
  scale,
  testId,
}: {
  value?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  menu?: ReactNode;
  scale: number;
  testId: (slot: string) => string | undefined;
}): React.JSX.Element {
  return (
    <>
      <Box data-slot="value" sx={{ textAlign: "right" }} data-testid={testId("value")}>
        {value != null && <ListCardValue value={value} scale={scale} />}
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
