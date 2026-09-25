/**
 * Telling the strip's own scrolls from the visitor's (FUT-2606).
 *
 * Split from `SettingsSectionChips.tsx` so the chips stay a component file and
 * the rule for "who moved the strip" can be read in one place.
 */

/**
 * How near to where the strip aimed itself it has to come to rest for the scroll
 * to count as the strip's own. A smooth scroll lands on a device pixel, and the
 * target it was given is fractional.
 */
const LANDED_SLACK = 1;

/**
 * Where `scrollend` is missing: how long the strip has to go without a `scroll`
 * before it counts as settled. Generous on purpose — a busy main thread can go
 * several frames between ticks of a smooth scroll, and judging one mid-flight
 * would read the strip's own animation as the visitor's. Too long only delays a
 * re-centre; too short can latch the strip for good.
 */
const QUIET_BEFORE_SETTLED_MS = 250;

interface VisitorScrollWatch {
  /** True once the visitor has moved the strip themselves. */
  hasScrolled: () => boolean;
  /**
   * True while a scroll the visitor MAY be making has not come to rest yet. The
   * strip must not scroll itself under it: that would yank a drag in progress.
   */
  isUndecided: () => boolean;
  /** Where the strip last aimed itself, in its own pixels; `NaN` before it has. */
  aimedAt: () => number;
  /**
   * The strip is about to scroll itself to `left`. Records the aim and NOTHING
   * else: it used to disarm too, and a re-centre landing between a visitor's key
   * press (or wheel, or pan) and the first tick of the scroll it causes wiped
   * the arming — their scroll went unclaimed, read as the strip's own. Left
   * armed, the worst a stale arming does is put the strip's OWN next scroll
   * under judgement, which rests on its aim, is not latched, and disarms.
   */
  beforeOwnScroll: (left: number) => void;
  /** Called once an undecided scroll has come to rest and been judged. */
  onSettled: (listener: () => void) => void;
  detach: () => void;
}

type Listeners = Array<[string, (event: Event) => void]>;

/** A wheel's sideways travel: `deltaX`, or `deltaY` with Shift held, as browsers read it. */
function horizontalDelta(event: Event): number {
  if (!(event instanceof WheelEvent)) return 0;
  return event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
}

interface WatchState {
  pointer: boolean;
  touch: boolean;
  nudged: boolean;
  undecided: boolean;
  scrolled: boolean;
  aimed: number;
  quiet: ReturnType<typeof setTimeout> | undefined;
  settled: () => void;
}

/** Whether the strip came to rest where it last aimed itself — clamped as the browser would. */
function restsOnAim(strip: HTMLElement, aimed: number): boolean {
  const reachable = Math.min(aimed, strip.scrollWidth - strip.clientWidth);
  // Written so that `NaN` — the strip never aimed — reads as "not on aim".
  return Math.abs(strip.scrollLeft - reachable) <= LANDED_SLACK;
}

/**
 * Tell a scroll the VISITOR made from every other one.
 *
 * The `scroll` event cannot say: the strip's own `scrollTo` fires it, and so does
 * the browser clamping a strip whose content shrank. So a scroll is only a
 * CANDIDATE when it arrives during something only a visitor does:
 *
 * - a finger held on the strip (`touchstart` until `touchend`) — a drag;
 * - a pointer held on it (`pointerdown` until `pointerup`);
 * - a key press, a SIDEWAYS wheel, or the browser taking a pointer over to pan
 *   it (`pointercancel`), each armed until the next scroll under judgement has
 *   been judged — whoever's it turns out to be.
 *
 * and the verdict waits until the strip comes to REST (`scrollend`, or a quiet
 * spell where the browser has no `scrollend`): it is the visitor's only if the
 * strip rests somewhere other than where it last aimed itself.
 *
 * Judged at rest rather than per `scroll` because the strip's own smooth scroll
 * fires `scroll` for a third of a second, and a visitor who presses Tab or puts
 * a finger on a chip to scroll the PAGE in that window is not scrolling the
 * strip. Every tick of that animation used to count as theirs, the strip stopped
 * re-centring for good, and the open chip could be left clipped (FUT-2606
 * again, by another door). A visitor who really drags or wheels the strip
 * mid-animation cancels it, so the strip rests where THEY left it — and that
 * still counts. The one loss: a visitor who happens to leave it within a pixel
 * of the strip's own aim is not told apart from it, and the strip there is
 * already where it would have put itself.
 *
 * A tap is a pointer held with no scroll under it, so it never counts. A
 * vertical wheel scrolls the PAGE — the strip is `overflowY: hidden` — and is
 * not armed at all.
 */
export function watchVisitorScroll(strip: HTMLElement): VisitorScrollWatch {
  const view = strip.ownerDocument.defaultView;
  const hasScrollEnd = 'onscrollend' in strip;
  const state: WatchState = {
    pointer: false,
    touch: false,
    nudged: false,
    undecided: false,
    scrolled: false,
    aimed: Number.NaN,
    quiet: undefined,
    settled: () => undefined,
  };
  const set =
    (key: 'pointer' | 'touch' | 'nudged', value: boolean) =>
    (): void => {
      state[key] = value;
    };
  const settle = (): void => {
    // Only a scroll that was UNDER JUDGEMENT disarms. Chromium can end the
    // strip's own smooth scroll with a `scrollend` when another scroll cuts it
    // off, fired BEFORE that scroll's first `scroll` (seen with an instant one);
    // disarming there would hand the visitor's scroll to nobody.
    if (!state.undecided) return;
    state.undecided = false;
    state.nudged = false;
    if (!restsOnAim(strip, state.aimed)) state.scrolled = true;
    state.settled();
  };
  const onWheel = (event: Event): void => {
    if (horizontalDelta(event) !== 0) state.nudged = true;
  };
  const onScroll = (): void => {
    if (state.pointer || state.touch || state.nudged) state.undecided = true;
    if (!state.undecided || hasScrollEnd) return;
    // Every tick while undecided, armed or not: a quiet spell that began while
    // the strip was still moving would judge it mid-flight, away from its aim.
    clearTimeout(state.quiet);
    state.quiet = setTimeout(settle, QUIET_BEFORE_SETTLED_MS);
  };
  const onStrip: Listeners = [
    ['pointerdown', set('pointer', true)],
    ['touchstart', set('touch', true)],
    ['pointercancel', set('nudged', true)],
    ['keydown', set('nudged', true)],
    ['wheel', onWheel],
    ['scroll', onScroll],
    ['scrollend', settle],
  ];
  // A gesture can END off the strip, so its end is heard on the window.
  const onView: Listeners = [
    ['pointerup', set('pointer', false)],
    ['pointercancel', set('pointer', false)],
    ['touchend', set('touch', false)],
    ['touchcancel', set('touch', false)],
  ];
  for (const [type, listener] of onStrip) strip.addEventListener(type, listener, { passive: true });
  for (const [type, listener] of onView) view?.addEventListener(type, listener, { passive: true });
  return {
    hasScrolled: () => state.scrolled,
    isUndecided: () => state.undecided,
    aimedAt: () => state.aimed,
    beforeOwnScroll: (left) => {
      state.aimed = left;
    },
    onSettled: (listener) => {
      state.settled = listener;
    },
    detach: () => {
      clearTimeout(state.quiet);
      for (const [type, listener] of onStrip) strip.removeEventListener(type, listener);
      for (const [type, listener] of onView) view?.removeEventListener(type, listener);
    },
  };
}
