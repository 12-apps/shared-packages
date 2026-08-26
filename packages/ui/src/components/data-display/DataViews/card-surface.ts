import { alpha, keyframes, type CSSObject, type Theme } from "@mui/material/styles/index.js";

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

/**
 * ONE RADIUS FOR BOTH SHAPES, off the token scale on purpose.
 *
 * `Card`'s own steps are 4px and 8px and its `lg` is 16px, all chosen for a
 * surface nearly as tall as it is wide. A 56px row is not that shape — the
 * corner runs most of the way down both ends and curves away from the square
 * checkbox and square thumbnail inside it — and a tile that rounds harder than
 * the row it sits beside in the same view reads as a different component.
 *
 * 3px takes the hard point off the corner without being seen as a curve.
 * `divider` rows override it back to 0; a bottom rule has no corners to round.
 */
export const CARD_RADIUS = "3px";

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
function variantSx(variant: CardSurfaceVariant, theme: Theme): CardSx {
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
    // THEME-AWARE, and it keeps its edges.
    //
    // This was a hardcoded `rgba(255,255,255,·)` fill with a near-white border,
    // which had two problems. On a dark palette a 55%-white pane is not frosted
    // glass, it is a pale rectangle. And on a light one BOTH the fill and the
    // border land on white and vanish, so `glass` rendered as `text` — the same
    // nothing, reached by a different name.
    //
    // The blur is what makes it glass, and a blur is only visible over
    // something. So the pane keeps a real hairline and a shallow shadow: over a
    // plain surface it still reads as a raised pane rather than as absence, and
    // over an image or a gradient the blur does the rest.
    return {
      backgroundColor: alpha(theme.palette.background.paper, 0.55),
      backdropFilter: "blur(8px)",
      // `divider` as-is. NOT `alpha(divider, …)`: MUI's `alpha` REPLACES the
      // channel rather than scaling it, and `divider` is already a 12% black —
      // so asking for 80% of it produced an 80% black slab of a border.
      borderColor: theme.palette.divider,
      boxShadow: `0 1px 3px ${alpha(theme.palette.common.black, 0.1)}`,
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
 * The tile's lift — a card that has been RAISED, not one that is lit from within.
 *
 * This was Button's glow: a 20px bloom at 0.6 over a 40px bloom at 0.3, plus
 * `brightness(1.05)`. On a button, which is small and pressed and gone, that
 * reads as energy. On a tile it read as a neon sign — 40px of saturated colour
 * bleeding into the gaps of a grid whose whole job is to let the eye compare
 * cards, and the brightness filter washing the image and the caption with it.
 *
 * Three shadows doing three jobs instead: a hairline ring that tints the card's
 * own edge in the accent colour, a tight contact shadow, and one soft shadow
 * offset DOWNWARD. Offset is what separates elevation from emission — a glow is
 * symmetrical because its source is the object; a shadow falls because the
 * light is somewhere else. It stays legible on a dark canvas, where the old
 * bloom was the brightest thing on the screen.
 */
function liftSx(main: string): CardSx {
  return {
    boxShadow: [
      `0 0 0 1px ${alpha(main, 0.45)}`,
      `0 1px 2px ${alpha(main, 0.12)}`,
      `0 8px 20px -6px ${alpha(main, 0.3)}`,
    ].join(", "),
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
    // The bar on both; the lift only where there is room for it to spread.
    return {
      ...accentBar(main),
      ...(shape === "tile" ? liftSx(main) : {}),
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
/**
 * WHAT THE TWO NON-DEFAULT STATES LOOK LIKE — and why they cannot look alike.
 *
 * Both were `opacity: 0.6` and nothing else, so a record the business CANCELLED
 * and a row this user merely cannot touch were pixel-identical. The type has
 * always drawn the distinction (`CardState`); only the styling had not, which
 * made `cancelled` a comment rather than a state.
 *
 * `cancelled` is a VOIDED record: still there, still worth reading, no longer
 * counting. The figures get struck through, because a dimmed `R$ 1.250,00`
 * still reads as money owed and a struck one cannot.
 *
 * `disabled` is INERT: nothing to read into, nothing to do with. It goes
 * greyscale — which also drains the status chip's colour, the one thing on the
 * row still shouting for attention — and says so on hover.
 */
function stateSx(state: CardState): CardSx {
  if (state === "cancelled") {
    return {
      opacity: 0.65,
      // The META CLUSTER is struck too. It was left out, so a voided row kept a
      // crisp `05/08/2026, 13:45` and `PIX` between a struck title and a struck
      // total — the middle of the row reading as live data on a record the two
      // ends call void. Both lines of each pair go, as both lines of the caption
      // already do: on a cancelled record the label is as void as the value.
      '& [data-slot="value"], & [data-slot="caption"], & [data-slot="meta"]': {
        textDecoration: "line-through",
      },
    };
  }
  if (state === "disabled") {
    return { opacity: 0.45, filter: "grayscale(1)", cursor: "not-allowed" };
  }
  return { opacity: 1 };
}

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
    ...stateSx(state),
    ...variantSx(variant, theme),
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
