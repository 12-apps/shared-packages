"use client";

import { Checkbox } from "../../form/Checkbox";
import { Box } from "../../../mui/Box";

import { DragHandle, useDragItem } from "./data-views-drag";

/**
 * THE TWO GUTTERS AT THE HEAD OF A ROW — the drag grip and the select checkbox.
 *
 * Split from `base-list-card` at the size gate. Both answer the same question in
 * the same way: whether to occupy a rail, hold one open, or leave the template
 * altogether. See `railsTemplateFor` for why the third option has to exist.
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
    <Box data-slot="drag" sx={{ position: "relative", zIndex: 1 }}>
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
        aria-label="Selecionar"
      />
    </Box>
  );
}
