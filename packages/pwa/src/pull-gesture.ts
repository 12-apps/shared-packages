/**
 * The pull-to-refresh gesture, as arithmetic and a state machine (12-61).
 *
 * Framework-free on purpose, for the same reason `@12-apps/app-shell` split
 * `loadRouteChunk` away from `lazyRoute`: the interesting cases here are the
 * ones a renderer makes hard to reach — a finger that starts down and turns
 * sideways, a pull that begins inside a horizontally-scrolling rail, a second
 * finger arriving mid-drag. Expressed over plain `{x, y}` points they are eight
 * lines of test each, with no `TouchEvent` to fabricate.
 *
 * `@12-apps/pwa/react`'s `PullToRefresh` is the other half: it turns touch
 * events into points, and phases into pixels.
 *
 * ## Two decisions the machine encodes rather than the component
 *
 * **A pull is not claimed until it has proved it is one.** The first
 * {@link PullGeometry.engagePx} of travel are watched and NOT consumed, so an
 * ordinary scroll and a sideways swipe both keep working — the component only
 * calls `preventDefault()` once {@link PullTracker.move} says the gesture is
 * `claimed`. Claiming on the first pixel is how a pull-to-refresh eats a
 * carousel.
 *
 * **Claimed is forever, until the finger lifts.** Once the gesture is ours the
 * direction tests stop running, so dragging back up shrinks the indicator to
 * zero instead of handing the page back mid-drag and jerking the content. That
 * is what every native implementation does, and the reason is the same: a
 * gesture that changes owner under the finger reads as a bug.
 */

/** What the gesture is doing right now, from the user's point of view. */
export type PullPhase =
  /** Nothing to draw: no pull, or one that turned out to be a scroll. */
  | "idle"
  /** Being pulled, but not far enough to do anything on release. */
  | "pulling"
  /** Past the threshold — releasing now refreshes. */
  | "armed";

export interface PullGeometry {
  /**
   * Finger travel before the gesture commits to being a pull, in CSS pixels.
   * Below this nothing is drawn and nothing is prevented.
   */
  engagePx: number;
  /** The RENDERED distance at which the pull arms. */
  thresholdPx: number;
  /**
   * The asymptote: the rendered distance the pull approaches but never reaches,
   * however far the finger travels. See {@link resistPull}.
   */
  maxPx: number;
}

/**
 * Defaults tuned against a phone rather than a trackpad.
 *
 * `engagePx: 12` is a little above the ~8px most browsers use to distinguish a
 * tap from a drag, so a shaky tap on a link never draws a spinner.
 *
 * `thresholdPx: 64` against `maxPx: 120` needs ~137px of finger travel to arm
 * (see {@link resistPull} for the arithmetic) — around a fifth of a phone
 * screen, which is deliberate: this gesture reloads the document and throws
 * away whatever is on screen, so it must be harder to trip than a scroll.
 */
export const DEFAULT_PULL_GEOMETRY: PullGeometry = {
  engagePx: 12,
  thresholdPx: 64,
  maxPx: 120,
};

/** A touch point, viewport-relative — `clientX` / `clientY` and nothing else. */
export interface PullPoint {
  x: number;
  y: number;
}

/** What {@link PullTracker.move} decided about this touch. */
export interface PullUpdate {
  phase: PullPhase;
  /** The rendered pull distance, in CSS pixels. `0` unless claimed. */
  distance: number;
  /**
   * Whether the gesture belongs to us now. The component calls
   * `preventDefault()` exactly when this is true — never before, or an
   * undecided touch stops scrolling the page.
   */
  claimed: boolean;
}

const IDLE: PullUpdate = { phase: "idle", distance: 0, claimed: false };

/**
 * Rubber-band raw finger travel into a rendered distance.
 *
 * `travel * max / (travel + max)` is 1:1 for the first few pixels — so the
 * indicator feels stuck to the finger where that matters most — and flattens
 * towards `max` from there, so there is a physical "this is as far as it goes"
 * without a hard stop that reads as a dropped gesture.
 *
 * Inverting it gives the travel needed to arm: `threshold * max / (max -
 * threshold)`. The defaults above are picked from that inverse, not guessed.
 */
export function resistPull(travelPx: number, maxPx: number): number {
  if (travelPx <= 0) return 0;
  return (travelPx * maxPx) / (travelPx + maxPx);
}

export interface PullTracker {
  /** Begin watching a touch that started somewhere a pull is allowed. */
  begin: (point: PullPoint) => void;
  /** Advance the gesture. Safe to call with no `begin` — answers idle. */
  move: (point: PullPoint) => PullUpdate;
  /** Lift: `true` when the pull was armed and the caller should refresh. */
  release: () => boolean;
  /** Abandon the gesture without refreshing (a cancel, a second finger). */
  cancel: () => void;
}

/**
 * One gesture's worth of state.
 *
 * A closure rather than a class so the component can hold it in a `useRef` and
 * never think about `this`; a factory rather than module state so two mounted
 * instances (or two tests) cannot tread on each other.
 */
export function createPullTracker(
  geometry: PullGeometry = DEFAULT_PULL_GEOMETRY,
): PullTracker {
  let origin: PullPoint | null = null;
  let claimed = false;
  let distance = 0;

  const reset = (): void => {
    origin = null;
    claimed = false;
    distance = 0;
  };

  /**
   * Should this touch, not yet claimed, be abandoned?
   *
   * Two ways out, and both mean "the user is doing something else": the finger
   * moved UP (a normal scroll down), or it moved further sideways than down (a
   * horizontal rail, of which a storefront has several).
   */
  const abandons = (dx: number, dy: number): boolean =>
    dy <= 0 || Math.abs(dx) > Math.abs(dy);

  return {
    begin(point) {
      origin = point;
      claimed = false;
      distance = 0;
    },

    move(point) {
      if (origin === null) return IDLE;
      const dy = point.y - origin.y;
      const dx = point.x - origin.x;

      if (!claimed) {
        if (abandons(dx, dy)) {
          reset();
          return IDLE;
        }
        // Still undecided: watched, not consumed.
        if (dy < geometry.engagePx) return IDLE;
        claimed = true;
      }

      distance = resistPull(dy, geometry.maxPx);
      return {
        phase: distance >= geometry.thresholdPx ? "armed" : "pulling",
        distance,
        claimed: true,
      };
    },

    release() {
      const refresh = claimed && distance >= geometry.thresholdPx;
      reset();
      return refresh;
    },

    cancel: reset,
  };
}

/**
 * The attribute a host puts on a subtree the gesture must keep its hands off.
 *
 * An escape hatch with a name, because the ancestor walk below cannot recognise
 * every reason a region wants its own vertical drags — a signature pad, a map,
 * a slider. `data-pull-refresh="off"` says so in the markup, where the person
 * building that region is already looking.
 */
export const PULL_REFRESH_OPT_OUT_ATTR = "data-pull-refresh";

/** Whether `element` can scroll vertically and is not already at its top. */
function scrolledPastTop(element: Element): boolean {
  return element.scrollTop > 0 && element.scrollHeight > element.clientHeight;
}

/**
 * Whether something between `target` and `boundary` should keep this gesture.
 *
 * Walks the ancestor chain and answers yes for the two cases that would
 * otherwise refresh the page out from under somebody who was reading: a nested
 * scroller that is scrolled DOWN (pulling in it scrolls it back up — that is
 * its gesture, not ours), and an explicit opt-out.
 *
 * A nested scroller sitting AT its top is deliberately not a blocker: it has
 * nowhere to go, so the pull belongs to the page, which is what makes the
 * gesture work on a short list inside a long screen.
 */
export function pullBlockedBy(target: EventTarget | null, boundary: Element | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node !== null) {
    if (node.getAttribute(PULL_REFRESH_OPT_OUT_ATTR) === "off") return true;
    if (scrolledPastTop(node)) return true;
    if (node === boundary) return false;
    node = node.parentElement;
  }
  return false;
}

/** Whether the document itself is scrolled to the very top. */
export function documentAtTop(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.scrollingElement ?? document.documentElement;
  return (root?.scrollTop ?? 0) <= 0;
}
