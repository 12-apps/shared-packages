/**
 * The one reading of a finger's travel, shared by every swipeable surface
 * (the Lightbox and the Carousel), so the two cannot disagree about what a
 * swipe is.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** Whichever axis moved further decides what the gesture meant. */
export const swipeAxis = (deltaX: number, deltaY: number): 'x' | 'y' =>
  Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';

/**
 * A fling is a short, fast flick: faster than this many px per millisecond.
 * Unit-free on purpose, it is a speed and not a length.
 */
export const FLING_SPEED = 0.4;

interface ClassifySwipeInput {
  deltaX: number;
  deltaY: number;
  /** How far the travel must go to count, in the px a touch event reports. */
  distance: number;
  /** Milliseconds the gesture took. With it, a fast flick short of `distance` still counts. */
  elapsed?: number;
  /** The shortest travel a fling may have; defaults to a quarter of `distance`. */
  flingDistance?: number;
}

const DIRECTIONS = {
  x: { positive: 'right', negative: 'left' },
  y: { positive: 'down', negative: 'up' },
} as const;

/** Whether `travel` px in `elapsed` ms is a fling: fast, and not tiny. */
const isFling = (travel: number, elapsed: number | undefined, minimum: number): boolean =>
  elapsed !== undefined && elapsed > 0 && travel >= minimum && travel / elapsed > FLING_SPEED;

/**
 * The direction a gesture swiped, or `null` when it was a tap or a nudge. The
 * axis is the one that moved further; the travel must pass `distance`, or be a
 * fling when `elapsed` is given.
 */
export const classifySwipe = ({
  deltaX,
  deltaY,
  distance,
  elapsed,
  flingDistance = distance / 4,
}: ClassifySwipeInput): SwipeDirection | null => {
  const axis = swipeAxis(deltaX, deltaY);
  const signed = axis === 'x' ? deltaX : deltaY;
  const travel = Math.abs(signed);

  if (travel <= distance && !isFling(travel, elapsed, flingDistance)) return null;
  return DIRECTIONS[axis][signed > 0 ? 'positive' : 'negative'];
};
