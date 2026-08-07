import { alpha, keyframes, type CSSObject, type Theme } from "@mui/material";

import { fadeInScaleAnimation } from "../Badge/Badge.animations";

/**
 * A plain style object, not MUI's `SxProps`.
 *
 * `SxProps` is a union including arrays and functions, so a value typed as one
 * cannot be spread — and these fragments exist precisely to be merged. Note also
 * that `Card` merges by SPREADING (`sx={{ ...defaults, ...sx }}`), so handing it
 * a function yields nothing at all: resolve the theme with `useTheme` first.
 */
type CardSx = CSSObject | Record<string, unknown>;

/** The ring, as scale + opacity so it never leaves the compositor. */
const pulseRing = keyframes`
  0% { transform: scale(1); opacity: 0.9; }
  70% { transform: scale(1.04); opacity: 0; }
  100% { transform: scale(1.04); opacity: 0; }
`;

/**
 * THE CONTRACT BOTH CARDS IMPLEMENT.
 *
 * `BaseCard` (a tile) and `BaseListCard` (a row) are one object seen from two
 * angles, so the surface — variant, colour, selectability, draggability,
 * emphasis and state — is declared once and spread into both.
 */

/**
 * How much chrome the surface claims. Button's vocabulary, spelled Button's
 * way: a card and a button are both surfaces the operator presses, and having
 * one say `outline` while the other says `outlined` taxes everyone who writes
 * both. Chip's `filled | outlined` was the wrong model — a chip is a token in a
 * sentence and has only those two things to say.
 */
export type CardSurfaceVariant = "outline" | "ghost" | "text" | "glass";

/** The theme colour a card's selection and emphasis are drawn in. */
export type CardSurfaceColor =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info";

/**
 * Why this card is asking to be noticed.
 *
 * ONE union, not six booleans. `glow`/`pulse`/`animate`/`bounce`/`shimmer`
 * combined into 32 states of which about three meant anything —
 * `pulse + shimmer + bounce` is not a thing anyone wants, and every one of
 * those combinations was a state somebody could reach by accident.
 */
export type CardEmphasis =
  /** Nothing. The overwhelming default. */
  | "none"
  /** Look here now: an accent bar, and a ring that beats six times and settles. */
  | "attention"
  /** This just arrived: an accent bar and one fade-in. */
  | "new";

/** A row and a tile carry emphasis differently — see `emphasisSx`. */
type CardShape = "row" | "tile";

/**
 * What this record IS, as opposed to how it looks.
 *
 * `dimmed` only greyed pixels, which left a cancelled row's buttons live and
 * clickable. This carries the meaning, so the card can also stop offering
 * actions on something that cannot be acted on.
 */
export type CardState = "default" | "cancelled" | "disabled";

export interface CardSurfaceProps {
  /** How much chrome the surface claims. Defaults to `outline`. */
  variant?: CardSurfaceVariant;
  /** Theme colour for selection and emphasis. Defaults to `primary`. */
  color?: CardSurfaceColor;
  /**
   * Can this card be selected — and does it show it?
   *
   * The capability, separate from the handler. `selectable` gets the checkbox
   * AND the selected treatment; `selectable={false}` has neither, however
   * `selected` is set, so a stale flag arriving with the data cannot make a
   * read-only row render as picked. Defaults to whether `onToggleSelect` exists.
   */
  selectable?: boolean;
  /** Whether this card is currently in the selection. */
  selected?: boolean;
  /**
   * Opt OUT of dragging even inside a drag container.
   *
   * Draggability is the container's decision (see `data-views-drag`); this is
   * the card's veto — a pinned row, a summary line, a record that may not move.
   */
  draggable?: boolean;
  /**
   * Where this card leads.
   *
   * PREFER THIS TO `onClick`. A clickable `<div>` cannot be cmd-clicked,
   * middle-clicked or "copy link address"'d, and wrapping interactive children
   * in a click handler is the a11y violation it looks like. With `href` the
   * title is a real `<a>` stretched over the card by a pseudo-element: one
   * whole-row target, correct tab order, every browser affordance intact, and
   * the buttons inside stay ordinary buttons.
   */
  href?: string;
  /** Anchor target, when `href` is set. */
  target?: string;
  /** Card click, for a card that does not navigate. See `href` first. */
  onClick?: () => void;
  /** What this record is. `cancelled`/`disabled` also suppress the actions. */
  state?: CardState;
  /** Why this card is asking to be noticed. Defaults to `none`. */
  emphasis?: CardEmphasis;
  className?: string;
  /**
   * One id; the parts derive from it (`${testId}-checkbox`, `-drag`, `-menu`,
   * `-value`). A prop per slot would have been `checkboxTestId`,
   * `menuTestId`, `valueTestId`… one for every part anybody ever tested.
   */
  testId?: string;
  "aria-label"?: string;
}

/** Every slot's test id, derived from the card's one. */
export function slotTestIds(testId: string | undefined): (slot: string) => string | undefined {
  return (slot) => (testId ? `${testId}-${slot}` : undefined);
}

/** Is this card selectable? Explicit wins; otherwise a handler implies it. */
export function isSelectable(
  props: Pick<CardSurfaceProps, "selectable"> & { onToggleSelect?: () => void },
): boolean {
  return props.selectable ?? props.onToggleSelect != null;
}

/** Can this record be acted on at all? */
export function isActionable(state: CardState | undefined): boolean {
  return state !== "disabled" && state !== "cancelled";
}

/**
 * Variant styling. Everything but `outline` drops the border.
 *
 * `ghost` keeps a faint SURFACE where `text` has none — without that the two
 * were pixel-identical at rest and the union carried a distinction it did not
 * draw. Ghost is "a surface, quietly"; text is "no surface at all", which is
 * what a host wants when it is drawing the container itself.
 */
function variantSx(variant: CardSurfaceVariant): CardSx {
  if (variant === "ghost") {
    return {
      border: 0,
      backgroundColor: "action.hover",
      "&:hover": { backgroundColor: "action.selected" },
    };
  }
  if (variant === "text") {
    return { border: 0, backgroundColor: "transparent", boxShadow: "none" };
  }
  if (variant === "glass") {
    return {
      backgroundColor: "rgba(255,255,255,0.55)",
      backdropFilter: "blur(8px)",
      borderColor: "rgba(255,255,255,0.35)",
    };
  }
  return {};
}

/**
 * MOTION IS OPT-IN, ALWAYS.
 *
 * Everything animated here is wrapped in this. Fifty rows breathing in unison
 * is a vestibular trigger, and honouring the OS setting is not a polish item —
 * it is the difference between a list somebody can look at and one they cannot.
 */
const MOTION_OK = "@media (prefers-reduced-motion: no-preference)";

/**
 * THE ROW'S ATTENTION SIGNAL IS A BAR, NOT A HALO.
 *
 * A glow is a weak signal in a list: full-width rows stacked tight means the
 * halo bleeds 15px into the neighbours above and below and reads as a rendering
 * artifact, and stacked with a `selected` ring and the browser's focus ring it
 * becomes three concentric halos on one row. Five rows needing attention at
 * once turns the page into a smear.
 *
 * A 3px accent on the leading edge is stronger, costs no motion at all, works
 * under reduced-motion, cannot bleed into a neighbour, and stacks cleanly
 * however many rows raise their hand. It is where operational tables land.
 */
function accentBar(main: string): CardSx {
  return {
    "&::before": {
      content: '""',
      position: "absolute",
      insetInlineStart: 0,
      insetBlock: 0,
      width: 3,
      borderStartStartRadius: "inherit",
      borderEndStartRadius: "inherit",
      backgroundColor: main,
      pointerEvents: "none",
    },
  };
}

/**
 * The tile's halo. Button's glow, kept for `BaseCard` — a grid of tiles has gaps
 * around each card, so the spread has somewhere to go that a row does not.
 */
function glowSx(main: string): CardSx {
  return {
    boxShadow: `0 0 20px 5px ${alpha(main, 0.6)}, 0 0 40px 10px ${alpha(main, 0.3)}`,
    filter: "brightness(1.05)",
  };
}

/**
 * A breath that STOPS.
 *
 * Six iterations, not `infinite`. A restaurant admin has this open for a whole
 * shift, and something pulsing in the periphery forever is fatigue rather than
 * urgency — worse, once two or three rows are doing it the signal means
 * nothing. It settles, and the accent bar carries the state from then on.
 *
 * Animating `transform`/`opacity` on a pseudo-element, never `box-shadow`: a
 * box-shadow keyframe repaints every frame, and fifty of them drop frames on
 * exactly the tablet a restaurant floor uses. This one is compositor-only.
 */
function pulseSx(main: string): CardSx {
  return {
    [MOTION_OK]: {
      "&::after": {
        content: '""',
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        border: `2px solid ${main}`,
        animation: `${pulseRing} 1.6s ease-out 6`,
        pointerEvents: "none",
      },
    },
  };
}

/** The emphasis treatments, in the terms the shape can actually carry. */
function emphasisSx(emphasis: CardEmphasis, main: string, shape: CardShape): CardSx {
  if (emphasis === "attention") {
    // The bar on both; the halo only where there is room for it to spread.
    return {
      ...accentBar(main),
      ...(shape === "tile" ? glowSx(main) : {}),
      ...pulseSx(main),
    };
  }
  if (emphasis === "new") {
    return {
      ...accentBar(main),
      [MOTION_OK]: { animation: `${fadeInScaleAnimation} 240ms ease-out` },
    };
  }
  return {};
}

/**
 * The shared half of a card's styling. Each component adds its own geometry —
 * a tile's aspect ratio, a row's rails.
 */
export function cardSurfaceStyles(
  props: CardSurfaceProps & { selectable: boolean; shape: CardShape },
  theme: Theme,
): CardSx {
  const { variant = "outline", color = "primary", selected = false, selectable } = props;
  const { state = "default", emphasis = "none" } = props;
  const main = theme.palette[color].main;
  // Selection styling is gated on the CAPABILITY: a card that cannot be
  // selected must not render as selected because a stale flag came with its data.
  const showSelected = selectable && selected;
  return {
    transition: "border-color 120ms, box-shadow 120ms, background-color 120ms",
    opacity: state === "default" ? 1 : 0.6,
    ...variantSx(variant),
    ...(showSelected
      ? {
          borderColor: `${color}.main`,
          boxShadow: `inset 0 0 0 1px ${main}`,
          backgroundColor: "action.selected",
        }
      : {}),
    ...emphasisSx(emphasis, main, props.shape),
  };
}
