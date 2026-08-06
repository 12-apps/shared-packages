import type { CSSObject, Theme } from "@mui/material/styles";

/**
 * A plain style object, not MUI's `SxProps`.
 *
 * `SxProps` is a union that includes arrays and functions, so a value typed as
 * one cannot be spread — and these fragments exist precisely to be merged with
 * each other. `CSSObject` plus theme-token strings is what they actually are.
 */
type CardSx = CSSObject | Record<string, unknown>;


import { alpha, keyframes } from "@mui/material";

import { bounceAnimation, fadeInScaleAnimation, shimmerAnimation } from "../Badge/Badge.animations";

/**
 * The ring Button's `pulse` throws off — copied here rather than imported
 * because Button keeps it module-private. Same shape, so a pulsing card and a
 * pulsing button beat in time instead of looking like two different features.
 */
const pulseRing = keyframes`
  0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  70% { box-shadow: 0 0 0 15px currentColor; opacity: 0; }
  100% { box-shadow: 0 0 0 0 currentColor; opacity: 0; }
`;

/**
 * THE CONTRACT BOTH CARDS IMPLEMENT.
 *
 * `BaseCard` (a tile) and `BaseListCard` (a row) are the same object seen from
 * two angles, and until now they agreed on nothing but `selected` — one took
 * `divider`, neither took a colour, and only one could be dragged. A host that
 * lets the operator switch between Grade and Lista had to learn two vocabularies
 * for one decision.
 *
 * So the surface — variant, size, colour, selectability, draggability, the
 * decorative effects and the ARIA plumbing — is declared once here and spread
 * into both. Anything specific to being a tile or being a row stays on the
 * component that has it.
 *
 * The variants are NOT Chip's. A chip is a token in a sentence, so filled and
 * outlined is the whole of it; a card is a surface in a stack, and what it needs
 * to say is how far off the page it sits. Hence `elevated` and `ghost`, which a
 * chip has no use for.
 */

/**
 * How far off the page the card sits.
 *
 * The same vocabulary {@link Button} uses — `solid` / `outline` / `ghost` /
 * `text` — rather than a set invented here. A card and a button are both
 * surfaces the operator can press, and having one call it `outline` while the
 * other calls it `outlined` is a tax on everybody who writes both.
 *
 * Chip's `filled | outlined` was the wrong model to copy: a chip is a token in
 * a sentence and has only those two things to say. Button's scale is about how
 * much chrome the surface claims, which is exactly the question a card in a
 * stack has to answer.
 */
export type CardSurfaceVariant =
  /** A hairline border, no fill. The default: legible on any background. */
  | "outline"
  /** No border; a faint tint that only appears on hover. Quiet in a dense list. */
  | "ghost"
  /** No chrome at all. Structure only, for a host drawing its own container. */
  | "text";

/** Card size. Multiplies padding and type; `scale` is the fine-grained form. */
export type CardSurfaceSize = "sm" | "md" | "lg";

/** The theme colour a card's selection, fill and glow are drawn in. */
export type CardSurfaceColor =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info";

export interface CardSurfaceProps {
  /** How far off the page the card sits. Defaults to `outline`. */
  variant?: CardSurfaceVariant;
  /** Size step. Defaults to `md`. Multiplied by `scale` when both are given. */
  size?: CardSurfaceSize;
  /** Theme colour token for selection, fill and glow. Defaults to `primary`. */
  color?: CardSurfaceColor;
  /**
   * Can this card be selected — and does it show it?
   *
   * The capability, separate from the handler. A card that is `selectable` gets
   * the checkbox AND the selected treatment (ring, tint) when `selected`;
   * `selectable={false}` has neither, however `selected` is set. Defaults to
   * whether an `onToggleSelect` was supplied, so existing callers are unchanged.
   */
  selectable?: boolean;
  /** Whether this card is currently in the selection. */
  selected?: boolean;
  /**
   * Opt OUT of dragging even inside a drag container.
   *
   * Draggability is the container's decision (see `data-views-drag`); this is
   * the card's veto — a pinned row, a summary line, a record the operator may
   * not reorder. Defaults to true, so a container's decision stands unless a
   * card objects.
   */
  draggable?: boolean;
  /** Card click (e.g. open/edit). Selection and menu clicks never reach it. */
  onClick?: () => void;
  /** Visually de-emphasise (e.g. a disabled/cancelled entity). */
  dimmed?: boolean;
  className?: string;
  dataTestId?: string;
  /** A soft halo in `color` — draws the eye to one card in a full grid. */
  glow?: boolean;
  /** Breathe, for a card that wants attention now (a live/urgent record). */
  pulse?: boolean;
  /** Fade+scale in on mount. Defaults to false: a whole page of cards animating in is noise. */
  animate?: boolean;
  /** A sweep across the surface — for a card whose data is still arriving. */
  shimmer?: boolean;
  /** A single hop on mount, for a card that just appeared in a live list. */
  bounce?: boolean;
  /** Translucent + blurred, for a card over an image or a map. */
  glass?: boolean;
  "aria-label"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "aria-atomic"?: boolean;
}

/** Padding/type multiplier per size step. */
const SIZE_SCALE: Record<CardSurfaceSize, number> = { sm: 0.85, md: 1, lg: 1.25 };

/** The resolved multiplier: the size step, times any explicit `scale`. */
export function surfaceScale(size: CardSurfaceSize | undefined, scale: number | undefined): number {
  return SIZE_SCALE[size ?? "md"] * (scale ?? 1);
}

/** Is this card selectable? Explicit wins; otherwise a handler implies it. */
export function isSelectable(props: Pick<CardSurfaceProps, "selectable"> & { onToggleSelect?: () => void }): boolean {
  return props.selectable ?? props.onToggleSelect != null;
}

/** Variant styling. Both non-default variants drop the border. */
function variantSx(variant: CardSurfaceVariant): CardSx {
  if (variant === "ghost") {
    return {
      border: 0,
      backgroundColor: "transparent",
      "&:hover": { backgroundColor: "action.hover" },
    };
  }
  if (variant === "text") return { border: 0, backgroundColor: "transparent", boxShadow: "none" };
  return {};
}

/**
 * The decorative effects, as one sx fragment.
 *
 * `--glow-color` is the channel triple the Badge keyframes read; without it the
 * halo renders black, which reads as a shadow rather than a highlight.
 */
function effectsSx(props: CardSurfaceProps, theme: Theme): CardSx {
  const { glow, pulse, shimmer, bounce, animate, glass, color = "primary" } = props;
  const main = theme.palette[color].main;
  const animations = [
    bounce ? `${bounceAnimation} 1s ease` : "",
    animate ? `${fadeInScaleAnimation} 240ms ease-out` : "",
  ].filter(Boolean);
  return {
    ...(animations.length > 0 ? { animation: animations.join(", ") } : {}),
    // Button's glow, to the letter: a double halo plus a lift on hover.
    ...(glow
      ? {
          boxShadow: `0 0 20px 5px ${alpha(main, 0.6)}, 0 0 40px 10px ${alpha(main, 0.3)}`,
          filter: "brightness(1.05)",
          "&:hover": {
            boxShadow: `0 0 25px 8px ${alpha(main, 0.7)}, 0 0 50px 15px ${alpha(main, 0.4)}`,
            filter: "brightness(1.1)",
          },
        }
      : {}),
    // …and Button's pulse: a ring thrown by a pseudo-element BEHIND the card,
    // so it never moves the card itself. A grid of cards that grew and shrank
    // would reflow its neighbours on every beat.
    ...(pulse
      ? {
          position: "relative",
          overflow: "visible",
          "&::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "100%",
            height: "100%",
            borderRadius: "inherit",
            transform: "translate(-50%, -50%)",
            backgroundColor: main,
            opacity: 0.3,
            animation: `${pulseRing} 2s infinite`,
            pointerEvents: "none",
            zIndex: -1,
          },
        }
      : {}),
    ...(glass
      ? {
          backgroundColor: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(8px)",
          borderColor: "rgba(255,255,255,0.35)",
        }
      : {}),
    ...(shimmer
      ? {
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
          backgroundSize: "1000px 100%",
          backgroundRepeat: "no-repeat",
          animation: `${shimmerAnimation} 2s linear infinite`,
        }
      : {}),
  };
}

/**
 * The shared half of a card's styling: variant, colour, selection and effects.
 * Each component adds its own geometry (a tile's aspect ratio, a row's padding).
 */
export function cardSurfaceStyles(
  props: CardSurfaceProps & { selectable: boolean },
  theme: Theme,
): CardSx {
  const { variant = "outline", color = "primary", selected = false, selectable, dimmed } = props;
  // Selection styling is gated on the CAPABILITY, not just the flag: a card that
  // cannot be selected must not render as selected because a stale `selected`
  // came down with its data.
  const showSelected = selectable && selected;
  return {
    transition: "border-color 120ms, box-shadow 120ms, background-color 120ms",
    opacity: dimmed ? 0.6 : 1,
    ...variantSx(variant),
    ...(showSelected
      ? {
          borderColor: `${color}.main`,
          boxShadow: `inset 0 0 0 1px ${theme.palette[color].main}`,
          backgroundColor: "action.selected",
        }
      : {}),
    ...effectsSx(props, theme),
  };
}
