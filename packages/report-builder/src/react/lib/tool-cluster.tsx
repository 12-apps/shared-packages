/**
 * A block's TOOL CLUSTER: pinned top-right, and it never wraps (FUT-755).
 *
 * What it replaces: the header row used to be `flexWrap: "wrap"`, so a block
 * too narrow for title + chrome put the chrome on a SECOND LINE, left-aligned
 * under the title. That was a deliberate trade at the time, and the bug it was
 * avoiding was worse than the one it caused — an earlier row simply overflowed
 * at 390px and pushed ⋮ off-screen, and since ⋮ was the only route to Editar,
 * a report could not be edited on a phone at all.
 *
 * Overflow-into-the-menu answers that same problem without the trade: the row
 * never wraps, nothing is ever pushed off-screen, and nothing steals width
 * from the rendering below, because a tool that does not fit is not squeezed —
 * it MOVES, into the ⋮ menu, as a real labelled item running the same handler.
 *
 * The measuring half is `@12-apps/ui/utility/Overflow`, which is `DataViews`'
 * filter bar's own mechanism with the filter-shaped parts left behind. Two
 * copies of a resize loop drift apart silently, and this is the second cluster
 * in the product to need one.
 */
import { createContext, useContext, type JSX, type ReactNode } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { DropdownMenu, type DropdownMenuItem } from "@12-apps/ui/navigation/DropdownMenu";
import { splitToFit } from "@12-apps/ui/utility/Overflow";

import { NO_PRINT_CLASS } from "./print-export";

/** Marks a cluster the block card should reveal on hover. See the reveal sx. */
const BLOCK_TOOLS_ATTR = "data-block-tools";

/**
 * WHAT EACH THING IN THE ROW COSTS, IN PIXELS.
 *
 * Estimates, like `DataViews`' own: measuring the true width needs every tool
 * mounted first, and mounting them to decide whether to mount them is the
 * layout thrash the measurement exists to avoid. Deliberately generous —
 * over-pricing sheds one tool into a menu that names what it holds, while
 * under-pricing breaks the line, which is the failure being fixed.
 */
export const TOOL_ROW = {
  /**
   * One icon button. `size="sm"` icon-only is 5px of padding around a 16px
   * glyph plus a border each side — ~28px; 32 keeps a little slack.
   */
  tool: 32,
  /** The ⋮ trigger — the same button shape, so the same price. */
  menu: 32,
  /** The gap between two tools (`spacing={0.5}`). */
  gap: 4,
  /**
   * The narrowest a block title may get before the tools start shedding.
   *
   * Restated ONCE and used as both the CSS floor and the budget, because the
   * two disagreeing is the whole failure mode: a row that prices the title at
   * 140 while the DOM lets it take 200 sheds nothing and overflows anyway.
   */
  title: 140,
} as const;

/**
 * The measured width of the header row a cluster sits in.
 *
 * Through context rather than a prop because the cluster is handed to the
 * frame as an opaque `actions` node — the frame owns the row and can measure
 * it, but it has no idea what is inside. `0` means "not measured" (SSR, jsdom
 * without a ResizeObserver, or a cluster rendered outside a row), and every
 * caller reads that as degrade-nothing: keep every tool inline. Hiding tools
 * behind a trigger the same environment cannot render either would be worse.
 */
const ToolRowWidthContext = createContext(0);

/** Publishes the measured row width to whatever cluster is inside it. */
export function ToolRowProvider({
  width,
  children,
}: {
  width: number;
  children: ReactNode;
}): JSX.Element {
  return <ToolRowWidthContext value={width}>{children}</ToolRowWidthContext>;
}

/**
 * "Only on hover" — done so that it is not ONLY on hover.
 *
 * Spread onto the block's card, because CSS cannot select an ancestor: the
 * cluster is hidden by the card and revealed by the card, exactly as
 * `prototype.html` does it (`.block-tools{opacity:0}` +
 * `.block:hover .block-tools{opacity:1}`).
 *
 * Three things a naive `:hover` rule gets wrong, and what is done instead:
 *
 *  - **A keyboard user never hovers.** `:focus-within` reveals the cluster the
 *    moment a tab reaches it. Opacity rather than `display:none` is what makes
 *    that possible at all — a display-none control is not in the tab order, so
 *    it could never be focused into view.
 *  - **A touch device has no hover.** Under `(hover: none)` the cluster is
 *    permanent; there is no gesture that would otherwise summon it. Stated
 *    last so it wins over the base rule at equal specificity.
 *  - **An invisible control must not still be clickable.** `opacity: 0` alone
 *    leaves a live button floating over the header; `pointerEvents: none` goes
 *    with it and is handed back on reveal.
 *
 * The header reserves its height whether or not the cluster is showing (the
 * frame's `minHeight`), so revealing it never moves the block's contents.
 */
export const BLOCK_TOOLS_REVEAL_SX = {
  [`& [${BLOCK_TOOLS_ATTR}]`]: {
    opacity: 0,
    pointerEvents: "none",
    transition: "opacity 120ms ease",
  },
  [`&:hover [${BLOCK_TOOLS_ATTR}], &:focus-within [${BLOCK_TOOLS_ATTR}]`]: {
    opacity: 1,
    pointerEvents: "auto",
  },
  "@media (hover: none)": {
    [`& [${BLOCK_TOOLS_ATTR}]`]: { opacity: 1, pointerEvents: "auto" },
  },
} as const;

/** One action in the cluster — the same object whether it lands on the row or in the menu. */
export interface BlockTool {
  id: string;
  /** The icon button's accessible name AND the menu item's label. One string, so they cannot disagree. */
  label: string;
  icon: JSX.Element;
  onSelect: () => void;
  /** Kept identical in both places: an id that vanished at a narrow width is a broken suite. */
  dataTestId: string;
  /** A toggle that is currently on. */
  pressed?: boolean;
  /** Destructive: last for the visible slots, and last inside the menu. */
  danger?: boolean;
}

/** Three dots — the overflow trigger, drawn like every other tool in the row. */
function MenuGlyph(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

/** One tool as an icon button. Never text: the row is priced on square boxes. */
function ToolButton({ tool }: { tool: BlockTool }): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      color={tool.danger === true ? "danger" : "primary"}
      icon={tool.icon}
      active={tool.pressed === true}
      aria-pressed={tool.pressed}
      aria-label={tool.label}
      title={tool.label}
      onClick={tool.onSelect}
      dataTestId={tool.dataTestId}
    />
  );
}

/** The same action as a menu row — same label, same handler, same test id. */
function toMenuItem(tool: BlockTool): DropdownMenuItem {
  return {
    id: tool.id,
    label: tool.label,
    onClick: tool.onSelect,
    dataTestId: tool.dataTestId,
    color: tool.danger === true ? "danger" : undefined,
  };
}

/**
 * Order inside the menu: what was pushed off the row first, then the items
 * that live here whatever the width, then anything destructive.
 *
 * Destructive last is the one rule worth stating: a trash that overflows must
 * not land at the top of a menu, under the cursor that just opened it.
 */
function menuOrder(overflow: BlockTool[], permanent: DropdownMenuItem[]): DropdownMenuItem[] {
  return [
    ...overflow.filter((tool) => tool.danger !== true).map(toMenuItem),
    ...permanent,
    ...overflow.filter((tool) => tool.danger === true).map(toMenuItem),
  ];
}

/**
 * Which tools fit on the row, and what the ⋮ holds.
 *
 * The ⋮ is FURNITURE, not a candidate: it is what everything else escapes
 * into, so it is priced up front and can never itself be the thing that had no
 * room. When a cluster declares permanent menu items it is always on screen —
 * which is the editor, where ⋮ carries the move actions — and otherwise it
 * appears only once something has been pushed into it, because a menu with
 * nothing in it is a control that does nothing.
 */
function splitTools(
  tools: BlockTool[],
  rowWidth: number,
  hasPermanentMenu: boolean,
): { inline: BlockTool[]; overflow: BlockTool[] } {
  if (rowWidth <= 0) return { inline: tools, overflow: [] };
  return splitToFit(tools, {
    widthOf: () => TOOL_ROW.tool,
    keyOf: (tool) => tool.id,
    gap: TOOL_ROW.gap,
    available: rowWidth - TOOL_ROW.title - (hasPermanentMenu ? TOOL_ROW.menu : 0),
    overflowCost: hasPermanentMenu ? 0 : TOOL_ROW.menu,
    // DECLARED ORDER IS THE RANKING — `splitToFit` defaults to it, so there is
    // no second list to keep in step with the first. A cluster is written
    // most-important first, and a destructive tool is written LAST precisely
    // so it is the one that sheds: a delete that has to be found in a menu,
    // read and chosen is a delete that is harder to hit by accident.
  });
}

/**
 * The cluster: the tools that fit, then the ⋮ holding everything else.
 *
 * `null` when there is nothing at all to show, so a block with no actions
 * (one that failed to run) carries no empty box in its header.
 */
export function OverflowToolCluster({
  tools,
  menuItems = [],
  menuTestId,
  menuLabel,
  reveal = false,
}: {
  /** In render order, most important first. */
  tools: BlockTool[];
  /** Items that live in the menu at every width (the editor's move actions). */
  menuItems?: DropdownMenuItem[];
  menuTestId: string;
  menuLabel: string;
  /**
   * Fade with the block instead of standing on it.
   *
   * Opt-in, and only the VIEWER takes it. The editor's chrome is the primary
   * way to operate a block rather than a secondary affordance on top of a
   * reading surface — and it is what future-pay's reports e2e drives, where a
   * `pointer-events: none` resting state would fail Playwright's actionability
   * check before any hover could rescue it.
   */
  reveal?: boolean;
}): JSX.Element | null {
  const rowWidth = useContext(ToolRowWidthContext);
  const split = splitTools(tools, rowWidth, menuItems.length > 0);
  const items = menuOrder(split.overflow, menuItems);
  if (split.inline.length === 0 && items.length === 0) return null;

  return (
    <Stack
      direction="row"
      spacing={TOOL_ROW.gap / 8}
      sx={{ alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}
      className={NO_PRINT_CLASS}
      {...(reveal ? { [BLOCK_TOOLS_ATTR]: "" } : {})}
    >
      {split.inline.map((tool) => (
        <ToolButton key={tool.id} tool={tool} />
      ))}
      {items.length > 0 ? (
        <DropdownMenu
          size="sm"
          items={items}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              icon={<MenuGlyph />}
              aria-label={menuLabel}
              title={menuLabel}
              dataTestId={menuTestId}
            />
          }
        />
      ) : null}
    </Stack>
  );
}
