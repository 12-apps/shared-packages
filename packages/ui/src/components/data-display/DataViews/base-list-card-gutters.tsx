"use client";

import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { IconButton } from "@mui/material";

import { Checkbox } from "../../form/Checkbox";
import { Box } from "../../../mui/Box";

import { DragHandle, useDragItem } from "./data-views-drag";
import { useDataViewsCopy } from "./data-views-copy-context";

/**
 * THE THREE GUTTERS AT THE HEAD OF A ROW — the disclosure chevron, the drag grip
 * and the select checkbox.
 *
 * Split from `base-list-card` at the size gate. All three answer the same
 * question in the same way: whether to occupy a rail, hold one open, or leave
 * the template altogether. See `railsTemplateFor` for why the third option has
 * to exist.
 */

/**
 * MUI's Checkbox carries 9px of hit-area padding on every side.
 *
 * Left uncancelled, a row asking for 8px of padding puts the checkbox SQUARE 17px
 * in — and with the empty drag gutter's gap ahead of it, 46px in, which is what
 * made the left edge look like a mistake. The hit area is worth keeping; the
 * optical inset is not, so the padding is cancelled with a negative margin and
 * the glyph lands where the row's own padding says it should.
 */
const CHECKBOX_PAD = "-9px";

/** The grip. Its gutter is reserved only when the list says to reserve it. */
export function DragSlot({
  drag,
  reserve,
  testId,
}: {
  drag: ReturnType<typeof useDragItem>;
  reserve: boolean;
  testId?: string;
}): React.JSX.Element | null {
  if (!drag.draggable) return reserve ? <Box data-slot="drag" /> : null;
  return (
    // display:flex, as on the checkbox below: the grip is an inline-grid, and in
    // a block parent an inline box sits on the text baseline — the line box adds
    // descender leading under it (21px glyph in a 31px slot) and drops the grip
    // 5px below the row's centre. A flex parent has no baseline to sit on.
    <Box
      data-slot="drag"
      sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}
    >
      <DragHandle
        handleProps={drag.handleProps}
        gated={drag.handleProps !== undefined}
        testId={testId}
      />
    </Box>
  );
}

/** The select checkbox. Its gutter is reserved only when the list says to. */
export function SelectSlot({
  selectable,
  selected,
  reserve,
  onToggleSelect,
  testId,
}: {
  selectable: boolean;
  selected: boolean;
  reserve: boolean;
  onToggleSelect?: (event?: React.MouseEvent) => void;
  testId?: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  if (!selectable) return reserve ? <Box data-slot="select" /> : null;
  return (
    // z-index 1: above the stretched link, or the anchor swallows the click.
    <Box
      data-slot="select"
      sx={{ position: "relative", zIndex: 1, mx: CHECKBOX_PAD, display: "flex" }}
    >
      <Checkbox
        checked={selected}
        onChange={() => onToggleSelect?.()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect?.(event);
        }}
        size="small"
        data-testid={testId}
        aria-label={copy.selection.selectRow}
      />
    </Box>
  );
}

/**
 * THE DISCLOSURE CHEVRON — the affordance that says this row has more.
 *
 * Rendered only when the card was given a body to reveal. A chevron on a row
 * that opens onto nothing is worse than no chevron: it is a promise the row
 * cannot keep, and an operator who presses it twice learns to stop trusting the
 * column. So `BaseListCard` passes `null` here when it has no children, the
 * slot returns nothing, and — standalone — the rail leaves the template
 * entirely.
 *
 * ROTATED, NOT SWAPPED. One glyph turned 90° rather than a right-chevron
 * exchanged for a down-chevron: the rotation is animatable and reads as the
 * same object moving, where a swap is two icons flickering. It also keeps the
 * button's box identical in both states, so the caption beside it cannot shift
 * as the row opens.
 *
 * `stopPropagation`, because a row is frequently clickable in its own right —
 * opening the record is not the same act as peeking at its detail, and without
 * this the chevron would do both at once.
 */
export function DiscloseSlot({
  expandable,
  expanded,
  reserve,
  onToggle,
  controls,
  testId,
}: {
  expandable: boolean;
  expanded: boolean;
  reserve: boolean;
  onToggle: () => void;
  /** The id of the region this button opens, for `aria-controls`. */
  controls: string;
  testId?: string;
}): React.JSX.Element | null {
  if (!expandable) return reserve ? <Box data-slot="disclose" /> : null;
  return (
    // z-index 1 and flex for the same reasons the other two gutters use them:
    // above a stretched link that would otherwise swallow the click, and out of
    // a baseline that would drop the glyph below the row's centre.
    <Box
      data-slot="disclose"
      sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}
    >
      <IconButton
        size="small"
        aria-expanded={expanded}
        aria-controls={expanded ? controls : undefined}
        aria-label={expanded ? "Recolher detalhes" : "Expandir detalhes"}
        data-testid={testId}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        // The row's own keyboard handler treats Enter/Space as "open the
        // record"; the button already handles both, so the event must not reach
        // it and fire the second action too.
        onKeyDown={(event) => event.stopPropagation()}
        sx={{
          p: 0.25,
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 150ms ease",
          // Honour a reduced-motion preference: the state is carried by the
          // angle, not by the animation, so dropping the tween loses nothing.
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        <KeyboardArrowRightIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
