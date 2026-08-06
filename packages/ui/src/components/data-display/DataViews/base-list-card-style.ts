import type { CSSObject } from "@mui/material/styles";

/**
 * A plain style object, not MUI's `SxProps`.
 *
 * `SxProps` is a union that includes arrays and functions, so a value typed as
 * one cannot be spread — and these fragments exist precisely to be merged with
 * each other. `CSSObject` plus theme-token strings is what they actually are.
 */
type CardSx = CSSObject | Record<string, unknown>;


/**
 * HOW THE LIST ROW IS DRESSED — its widths, its cursors, its states.
 *
 * Split from `base-list-card` at the file-size gate along the seam that was
 * already there: that module is the slots and the order they sit in, this is
 * what they look like. Pure values and one function of its arguments; no React.
 */

/** Below this the row is too narrow to carry its middle columns. */
export const META_BREAK = 520;
/** …and below this the value/status wrap under the title rather than squeeze it. */
export const STACK_BREAK = 360;

/** Flush-list style: a bottom rule instead of the outline. */
const DIVIDER_SX = {
  border: 0,
  borderRadius: 0,
  borderBottom: 1,
  borderBottomStyle: "solid",
  borderBottomColor: "divider",
} as const;

/** Whole-card dragging: the cursor, and no touch-scroll stealing the gesture. */
const GRAB_SX = { touchAction: "none", "&:active": { cursor: "grabbing" } } as const;

/** Which cursor the row shows, in priority order. */
function rowCursor(draggable: boolean, interactive: boolean): string | undefined {
  if (draggable) return "grab";
  return interactive ? "pointer" : undefined;
}

/** The row shell: outlined tile or flush divider, plus the interactive states. */
export function listCardSx(opts: {
  pad: number;
  padY: number;
  interactive: boolean;
  divider: boolean;
  draggable: boolean;
}): CardSx {
  const { pad, padY, interactive, divider, draggable } = opts;
  return {
    // The card answers its OWN width — see the note at the top of this file.
    containerType: "inline-size",
    position: "relative",
    display: "block",
    width: "100%",
    px: pad,
    py: padY,
    cursor: rowCursor(draggable, interactive),
    ...(interactive ? { "&:hover": { backgroundColor: "action.hover" } } : {}),
    ...(draggable ? GRAB_SX : {}),
    ...(divider ? DIVIDER_SX : {}),
  };
}
