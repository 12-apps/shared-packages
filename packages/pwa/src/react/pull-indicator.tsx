/**
 * What a pull-to-refresh looks like (12-61).
 *
 * ## It is driven by CSS variables, not by props
 *
 * A pull emits a `touchmove` per frame, and re-rendering React 60 times a
 * second to move one element 3px is the classic way to make a gesture feel
 * cheap on exactly the phones that need it most. So the distance arrives as
 * custom properties written straight onto the node by
 * {@link PullToRefresh}, and React re-renders only when the PHASE changes —
 * three times per gesture at most. Everything the pull scales (how far the chip
 * has descended, how opaque it is, how far the arrow has turned) reads from
 * `--pwa-ptr-progress` and `--pwa-ptr-y`, so one imperative write drives all of
 * it and the component stays declarative about everything else.
 *
 * ## The glyph is drawn, not imported
 *
 * Same call `ShareIcon` makes next door: an icon font or an SVG asset is a
 * network round-trip in a component whose entire job is to appear the instant a
 * finger moves. The arrow is eight path commands.
 */
import { Box } from "@12-apps/ui/mui/Box";
import type { SxProps, Theme } from "@12-apps/ui/mui/styles";
import type { JSX, Ref } from "react";

import type { PullToRefreshMessages } from "../messages";

/** The phases the indicator draws — the tracker's three, plus the reload. */
export type PullIndicatorPhase = "idle" | "pulling" | "armed" | "refreshing";

/** Diameter of the chip, in px. Also its own translate reference. */
const CHIP_PX = 36;

export interface PullIndicatorProps {
  /** The node the gesture writes its custom properties onto. */
  ref?: Ref<HTMLDivElement>;
  phase: PullIndicatorPhase;
  messages: PullToRefreshMessages;
  /** Distance from the top of the viewport the chip descends from. */
  offsetTop: number | string;
  zIndex: number | string;
}

/** The announcement for a phase — see the note on {@link PullToRefreshMessages}. */
function statusFor(phase: PullIndicatorPhase, messages: PullToRefreshMessages): string {
  if (phase === "refreshing") return messages.refreshing;
  if (phase === "armed") return messages.armed;
  if (phase === "pulling") return messages.pulling;
  return "";
}

/**
 * Off-screen but announced — the pattern every design system spells `sr-only`.
 * Not `display: none`, which removes it from the accessibility tree along with
 * everything else.
 */
const SR_ONLY: SxProps<Theme> = {
  position: "absolute",
  // "1px", not 1: MUI's sizing transform reads a bare number <= 1 as a RATIO
  // and emits `width: 100%`, so this box was full-size and hidden only because
  // `clipPath` happened to be here too.
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

const chipSx = (offsetTop: number | string, zIndex: number | string): SxProps<Theme> => ({
  position: "fixed",
  top: offsetTop,
  left: "50%",
  zIndex,
  width: CHIP_PX,
  height: CHIP_PX,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  bgcolor: "background.paper",
  color: "text.secondary",
  boxShadow: 3,
  // The gesture cannot be caught by its own indicator: it is drawn over the
  // content the finger is dragging, and a chip that swallowed `touchmove`
  // would freeze the pull the moment it slid under the thumb.
  pointerEvents: "none",
  // `-100%` of its OWN height, so at rest the chip sits entirely above `top`
  // whatever `CHIP_PX` becomes, and the pull slides it into view.
  transform: "translate(-50%, calc(var(--pwa-ptr-y, 0px) - 100%))",
  opacity: "var(--pwa-ptr-opacity, 0)",
  // Only between gestures. A transition while the finger is down puts the chip
  // a frame behind it, which is precisely the lag this component avoids.
  '&:not([data-dragging="true"])': {
    transition: "transform 180ms ease-out, opacity 180ms ease-out",
  },
  '&[data-phase="armed"]': { color: "primary.main" },
});

const arrowSx: SxProps<Theme> = {
  display: "block",
  transition: "transform 120ms ease-out",
  // Turns with the pull, and lands upright-reversed exactly as it arms.
  transform: "rotate(calc(var(--pwa-ptr-progress, 0) * 180deg))",
  '[data-phase="refreshing"] &': {
    transform: "none",
    animation: "pwa-ptr-spin 700ms linear infinite",
  },
  "@keyframes pwa-ptr-spin": { from: { rotate: "0deg" }, to: { rotate: "360deg" } },
};

/** A down arrow while pulling; the same stroke, spinning, while it reloads. */
function Glyph({ phase }: { phase: PullIndicatorPhase }): JSX.Element {
  return (
    <Box component="svg" viewBox="0 0 24 24" width={20} height={20} aria-hidden sx={arrowSx}>
      {phase === "refreshing" ? (
        // An open arc reads as motion even at one frame; a full ring does not.
        <path
          d="M12 4a8 8 0 1 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M12 4v14m0 0 5-5m-5 5-5-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Box>
  );
}

export function PullIndicator({
  ref,
  phase,
  messages,
  offsetTop,
  zIndex,
}: PullIndicatorProps): JSX.Element {
  return (
    <Box
      ref={ref}
      data-testid="pull-to-refresh-indicator"
      data-phase={phase}
      // The chip is DECORATION: the arrow says nothing the live region below
      // does not say better, and at rest it is an `opacity: 0` box that is
      // still in the accessibility tree — so a screen-reader user met an
      // invisible "Atualizar a tela" at the top of every screen.
      aria-hidden={phase === "idle"}
      sx={chipSx(offsetTop, zIndex)}
    >
      <Glyph phase={phase} />
      {/*
        The live region is the INNER span, and carries no `aria-label`.
        Labelling the region itself gives it an accessible name, and a reader
        that computes the announcement from the name reads that name on every
        phase change — so all three of the strings below would go unheard.
      */}
      <Box component="span" role="status" aria-live="polite" sx={SR_ONLY}>
        {statusFor(phase, messages)}
      </Box>
    </Box>
  );
}
