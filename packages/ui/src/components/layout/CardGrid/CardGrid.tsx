import { Children, type CSSProperties, type ReactNode, type Ref } from "react";

import { cn } from "../../../utils/cn";

/**
 * How the grid turns surplus row space into layout:
 *
 * - `"fixed"` — every column is exactly `cardWidth` px; leftover row space is
 *   spread as even gutters (`justify-content: space-around`). Cards never resize;
 *   the column count changes with the viewport. This is the original tabwoah
 *   card-grid behavior.
 * - `"fluid"` — every column is *at least* `cardWidth` px and stretches (`1fr`)
 *   to fill the row, so cards grow to use the whole width. A lone card stays
 *   left-aligned at a single track's width rather than stretching edge to edge.
 * - `"scroll"` — a single row that scrolls horizontally, with fluid-width cards
 *   sized from the container so that exactly {@link SCROLL_VISIBLE_CARDS} cards
 *   plus a {@link SCROLL_PEEK_WIDTH}px sliver of the next one fit on screen (up
 *   to `maxCardWidth`, past which more cards simply fit). The sliver is the
 *   point: it makes the rail visibly continue past the fold, so the row reads as
 *   swipeable instead of as a finished pair of cards. Wrapping is off; the row
 *   overflows on the x and scroll-snaps to each card's start so a swipe lands on
 *   a clean card boundary.
 */
export type CardGridVariant = "fixed" | "fluid" | "scroll";

/** The grid gap, in px — mirrors the `gap: 1rem` below, for the scroll math. */
const GRID_GAP = 16;

/** `scroll`: how many WHOLE cards the rail commits to showing at once. */
const SCROLL_VISIBLE_CARDS = 2;

/**
 * `scroll`: px of the next card left visible past the last whole one — the
 * "there's more, swipe" hint. Wide enough to read as a clipped card (rounded
 * edge + a slice of its photo) rather than as a rendering glitch.
 */
const SCROLL_PEEK_WIDTH = 28;

/**
 * The `scroll` track width: the widest a card can be while the container still
 * shows `SCROLL_VISIBLE_CARDS` of them plus the peek — or, when there is nothing
 * to scroll to, while the cards still divide the row evenly. Capped at `max` so
 * a desktop-width rail packs in more cards instead of inflating them.
 *
 * The container (`100%`) has to cover, in the overflow case: N cards, the N gaps
 * that follow them (one between each pair, one before the peeked card), and the
 * peek. With no overflow there are only N-1 gaps and no peek.
 */
function scrollTrackWidth(count: number, max: number): string {
  const tracks = Math.max(1, Math.min(count, SCROLL_VISIBLE_CARDS));
  const overflows = count > tracks;
  const gaps = overflows ? tracks : tracks - 1;
  const reserved = gaps * GRID_GAP + (overflows ? SCROLL_PEEK_WIDTH : 0);
  return `min(${max}px, calc((100% - ${reserved}px) / ${tracks}))`;
}

interface CardGridProps {
  /**
   * `"fixed"`: the exact column width in px. `"fluid"`: the minimum column width
   * (columns grow from here). `"scroll"`: only seeds the default `maxCardWidth`
   * — a scroll track has no minimum, because a minimum is exactly what would
   * break the "two cards plus a peek" promise on a narrow phone.
   */
  cardWidth: number;
  /**
   * `"scroll"` only: the maximum fluid card width in px. Defaults to
   * `1.6 × cardWidth`.
   */
  maxCardWidth?: number;
  /** Layout behavior — see {@link CardGridVariant}. Defaults to `"fixed"`. */
  variant?: CardGridVariant;
  /** Additional classes appended to the default grid container */
  className?: string;
  /** `data-testid` for the grid container */
  gridTestId?: string;
  /** Ref forwarded to the grid container (used by `useMaxRowsHeight` clipping). */
  containerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * Shared grid container for card layouts. Renders responsive columns via CSS
 * grid, in one of three variants (see {@link CardGridVariant}).
 *
 * Ported from the tabwoah card grid (the `"fixed"` variant is verbatim). The one
 * adaptation: that app is Tailwind (`className="grid gap-4 pb-0.5"`); this one
 * has no Tailwind, so those three utilities (display:grid, gap 1rem,
 * padding-bottom 2px) live in `style`.
 */
export function CardGrid({
  cardWidth,
  maxCardWidth,
  variant = "fixed",
  className,
  gridTestId,
  containerRef,
  children,
}: CardGridProps) {
  const style: CSSProperties = {
    display: "grid",
    gap: "1rem",
    paddingBottom: "2px",
  };

  if (variant === "scroll") {
    const max = maxCardWidth ?? Math.round(cardWidth * 1.6);
    // One row, laid out as implicit columns, that scrolls sideways. Each column
    // is derived from the container so two whole cards plus a peek of the third
    // always fit (see `scrollTrackWidth`). Scroll-snap makes a swipe settle on a
    // card boundary instead of drifting mid-card.
    style.gridAutoFlow = "column";
    style.gridAutoColumns = scrollTrackWidth(Children.count(children), max);
    style.overflowX = "auto";
    style.overflowY = "hidden";
    style.scrollSnapType = "x mandatory";
  } else if (variant === "fluid") {
    style.gridTemplateColumns = `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`;
  } else {
    style.gridTemplateColumns = `repeat(auto-fill, ${cardWidth}px)`;
    // `space-around` only distributes leftover width in the fixed variant; the
    // fluid variant consumes it via `1fr` and scroll overflows instead.
    style.justifyContent = "space-around";
  }

  // In the scroll variant each card is a snap target, so a swipe aligns to its
  // start. The snap-align sits on a wrapper (the grid item) so callers' children
  // stay untouched; the other variants render children directly.
  const content =
    variant === "scroll"
      ? Children.map(children, (child) => (
          <div style={{ scrollSnapAlign: "start" }}>{child}</div>
        ))
      : children;

  return (
    <div ref={containerRef} className={cn(className)} style={style} data-testid={gridTestId}>
      {content}
    </div>
  );
}
