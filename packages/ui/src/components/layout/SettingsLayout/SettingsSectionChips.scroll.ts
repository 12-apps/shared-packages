/**
 * Telling the strip's own scrolls from the visitor's (FUT-2606). Split from
 * `SettingsSectionChips.tsx` so the chips stay a component file and the rule
 * for "who moved the strip" can be read in one place.
 */

/**
 * How near to where the strip aimed itself it has to come to rest for the scroll
 * to count as the strip's own. A smooth scroll lands on a device pixel, and the
 * target it was given is fractional.
 */
const LANDED_SLACK = 1;

/**
 * Where `scrollend` is missing: how long the strip goes without a `scroll`
 * before it counts as settled — generous, since a busy thread can go several
 * frames between smooth-scroll ticks and judging one mid-flight would read
 * the strip's own animation as the visitor's. Too short can latch it for good.
 */
const QUIET_BEFORE_SETTLED_MS = 250;

/**
 * How much `scrollLeft` has to move, tick to tick, before a `scroll` event is
 * even a CANDIDATE for arming (FUT-2775). Below this, a browser's own rounding
 * or a repeated event carrying no real motion cannot arm anything by itself.
 * This alone does not stop the false latch the ticket describes: the strip's
 * own `scrollTo` produces real per-tick deltas well past this line, same as a
 * drag would. It only rules out a scroll event that moved nothing.
 */
const SCROLL_DELTA_EPSILON = 2;

/**
 * How far a pointer/touch must travel from where it went down to count as
 * MOVED, not merely resting (FUT-2775) — below this, a held tremor isn't a drag.
 */
const POINTER_MOVE_EPSILON = 2;

/**
 * How long a key, sideways wheel or pan stays armed through a scroll the strip
 * made itself (FUT-2848) — a busy thread can finish a re-centre before the
 * key's scroll ticks once; past this it lapses, so a later clamp isn't the visitor.
 */
const NUDGE_FRESH_MS = 1000;

interface VisitorScrollWatch {
  /** True once the visitor has moved the strip themselves. */
  hasScrolled: () => boolean;
  /**
   * True while a scroll the visitor MAY be making has not come to rest yet. The
   * strip must not scroll itself under it: that would yank a drag in progress.
   */
  isUndecided: () => boolean;
  /**
   * Where the strip last aimed itself, PHYSICAL pixels (see {@link physicalScrollLeft}) —
   * direction-blind, like every other geometry read in this file. `NaN` before it has.
   */
  aimedAt: () => number;
  /**
   * The strip is about to scroll itself to `left` (physical pixels). Records the
   * aim and NOTHING
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

const STRIP_SCROLLING_KEYS = new Set(['ArrowLeft', 'ArrowRight']); // verified live in Chromium (FUT-2862)

interface WatchState {
  pointer: boolean;
  touch: boolean;
  nudged: boolean;
  /** When `nudged` was set (`Date.now()` ms), and whether it outlived an own verdict. */
  nudgedAt: number;
  nudgeKept: boolean;
  undecided: boolean;
  scrolled: boolean;
  aimed: number;
  quiet: ReturnType<typeof setTimeout> | undefined;
  settled: () => void;
  /** `scrollLeft` as of the last `scroll` tick, updated every tick regardless of arming. */
  lastScrollLeft: number;
  /** Where a `pointerdown` on the strip landed, in viewport `clientX`. `NaN` while up. */
  pointerDownAt: number;
  /** True once that pointer has travelled past {@link POINTER_MOVE_EPSILON} from `pointerDownAt`. */
  pointerMoved: boolean;
  /** Same pair, for `touchstart`/`touchmove` — a distinct event stream on some engines. */
  touchDownAt: number;
  touchMoved: boolean;
}

type RtlScrollType = 'default' | 'negative' | 'reverse';

let cachedRtlScrollType: RtlScrollType | undefined;

/**
 * Which of the three incompatible conventions this engine reports an RTL
 * scroller's `scrollLeft` in, probed once and cached (FUT-2775).
 *
 * Per the CSSOM View spec, an RTL scroller's `scrollLeft` is `0` at its
 * (right-hand) start and goes NEGATIVE toward the end — `'negative'` below,
 * what every current evergreen engine implements. Older WebKit mirrored that
 * (`'reverse'`: `0` at the start, growing toward `+max`), and older
 * Chromium/Safari ignored `dir` altogether and kept the plain left-to-right
 * numbering (`'default'`). A hidden probe, not a version sniff, tells them
 * apart — the same technique `@mui/utils`'s `detectScrollType` uses for
 * `Tabs`; reimplemented here rather than taking a new dependency for one
 * probe.
 */
function detectRtlScrollType(doc: Document): RtlScrollType {
  if (cachedRtlScrollType) return cachedRtlScrollType;
  // The exact pixel values below are the probe's mechanism, not a design size:
  // what matters is only that the INNER box is wider than the OUTER one, so the
  // outer one has something to scroll — same technique `@mui/utils` uses,
  // detached and off-screen either way.
  const probe = doc.createElement('div');
  const inner = doc.createElement('div');
  inner.style.width = '10px';
  probe.appendChild(inner);
  probe.dir = 'rtl';
  probe.style.width = '4px';
  probe.style.position = 'absolute';
  probe.style.top = '-1000px';
  probe.style.overflow = 'scroll';
  doc.body.appendChild(probe);
  let type: RtlScrollType = 'reverse';
  if (probe.scrollLeft > 0) {
    type = 'default';
  } else {
    probe.scrollLeft = 1;
    if (probe.scrollLeft === 0) type = 'negative';
  }
  doc.body.removeChild(probe);
  cachedRtlScrollType = type;
  return type;
}

/** True when the strip's own computed direction is right-to-left. */
export function isRtlStrip(strip: HTMLElement): boolean {
  const view = strip.ownerDocument.defaultView;
  const getComputedStyle = view?.getComputedStyle ?? globalThis.getComputedStyle;
  return getComputedStyle(strip).direction === 'rtl';
}

/**
 * `strip.scrollLeft`, renumbered so `0` is always the strip's physical LEFT
 * edge and larger is always further physically right — whatever `direction`
 * and whatever convention this engine uses to report it raw (FUT-2775).
 *
 * Every geometry read in this file (`getBoundingClientRect`) is already in
 * that same physical, direction-blind coordinate space, so this is what makes
 * `scrollLeft` combinable with it at all.
 */
export function physicalScrollLeft(strip: HTMLElement): number {
  const raw = strip.scrollLeft;
  if (!isRtlStrip(strip)) return raw;
  const max = strip.scrollWidth - strip.clientWidth;
  const type = detectRtlScrollType(strip.ownerDocument);
  if (type === 'negative') return raw + max;
  if (type === 'reverse') return max - raw;
  return raw;
}

/** The inverse of {@link physicalScrollLeft}: a physical offset back to this engine's raw `scrollLeft`. */
export function toRawScrollLeft(strip: HTMLElement, physical: number): number {
  if (!isRtlStrip(strip)) return physical;
  const max = strip.scrollWidth - strip.clientWidth;
  const type = detectRtlScrollType(strip.ownerDocument);
  if (type === 'negative') return physical - max;
  if (type === 'reverse') return max - physical;
  return physical;
}

/** Whether the gesture that armed `nudged` happened within {@link NUDGE_FRESH_MS}. */
function nudgeIsFresh(state: WatchState): boolean {
  return Date.now() - state.nudgedAt <= NUDGE_FRESH_MS;
}

/** Whether the strip came to rest where it last aimed itself — clamped as the browser would. */
function restsOnAim(strip: HTMLElement, aimed: number): boolean {
  const reachable = Math.min(aimed, strip.scrollWidth - strip.clientWidth);
  // Written so that `NaN` — the strip never aimed — reads as "not on aim".
  return Math.abs(physicalScrollLeft(strip) - reachable) <= LANDED_SLACK;
}

/** The pointer/touch/keydown/wheel listeners that arm `state`, split out of `watchVisitorScroll` (line budget). */
function createGestureListeners(state: WatchState): { onStrip: Listeners; onView: Listeners } {
  // `MouseEvent`, not `PointerEvent`: a real `PointerEvent` IS one (it extends
  // `MouseEvent`), so this reads `clientX` off it just the same in a browser —
  // but jsdom (this file's own test environment) has never implemented
  // `PointerEvent` at all, and the bare identifier throws a `ReferenceError`
  // the moment anything evaluates `instanceof PointerEvent`, pointer event or
  // not. Same reasoning as feature-checking `scrollTo` elsewhere in this file:
  // nothing in here is worth a crash over which constructor a probe prefers.
  const onPointerDown = (event: Event): void => {
    state.pointer = true;
    state.pointerMoved = false;
    state.pointerDownAt = event instanceof MouseEvent ? event.clientX : Number.NaN;
  };
  const onPointerMove = (event: Event): void => {
    if (!(event instanceof MouseEvent) || Number.isNaN(state.pointerDownAt)) return;
    if (Math.abs(event.clientX - state.pointerDownAt) > POINTER_MOVE_EPSILON) state.pointerMoved = true;
  };
  const onPointerUp = (): void => {
    state.pointer = false;
    state.pointerDownAt = Number.NaN;
  };
  const onTouchStart = (event: Event): void => {
    state.touch = true;
    state.touchMoved = false;
    state.touchDownAt = event instanceof TouchEvent ? (event.touches[0]?.clientX ?? Number.NaN) : Number.NaN;
  };
  const onTouchMove = (event: Event): void => {
    if (!(event instanceof TouchEvent) || Number.isNaN(state.touchDownAt)) return;
    const clientX = event.touches[0]?.clientX;
    if (clientX !== undefined && Math.abs(clientX - state.touchDownAt) > POINTER_MOVE_EPSILON) {
      state.touchMoved = true;
    }
  };
  const onTouchEnd = (): void => {
    state.touch = false;
    state.touchDownAt = Number.NaN;
  };
  const nudge = (): void => {
    state.nudged = true;
    state.nudgedAt = Date.now();
    state.nudgeKept = false;
  };
  const onPointerCancel = (): void => {
    nudge();
    onPointerUp();
  };
  const onKeydown = (event: Event): void => {
    if (event instanceof KeyboardEvent && STRIP_SCROLLING_KEYS.has(event.key)) nudge();
  };
  const onWheel = (event: Event): void => {
    if (horizontalDelta(event) !== 0) nudge();
  };
  return {
    onStrip: [
      ['pointerdown', onPointerDown],
      ['pointermove', onPointerMove],
      ['touchstart', onTouchStart],
      ['touchmove', onTouchMove],
      ['pointercancel', onPointerCancel],
      ['keydown', onKeydown],
      ['wheel', onWheel],
    ],
    // A gesture can END off the strip, so its end is heard on the window.
    onView: [
      ['pointerup', onPointerUp],
      ['pointercancel', onPointerUp],
      ['touchend', onTouchEnd],
      ['touchcancel', onTouchEnd],
    ],
  };
}

/**
 * Judge the scroll under judgement once the strip rests. Only a scroll UNDER
 * JUDGEMENT disarms: Chromium can fire `scrollend` for the strip's own scroll
 * cut off by another BEFORE that one's first `scroll`, and disarming there
 * would hand the visitor's scroll to nobody.
 */
function settleJudgement(strip: HTMLElement, state: WatchState): void {
  if (!state.undecided) return;
  state.undecided = false;
  const own = restsOnAim(strip, state.aimed);
  if (!own) state.scrolled = true;
  // The strip's own scroll does not use up a gesture armed moments ago: the
  // scroll that gesture causes may still be on its way (FUT-2848).
  state.nudgeKept = own && nudgeIsFresh(state);
  if (!state.nudgeKept) state.nudged = false;
  state.settled();
}

/** A gesture kept through the strip's own scroll lapses once stale (FUT-2848). */
function dropStaleNudge(state: WatchState): void {
  if (!state.nudgeKept || nudgeIsFresh(state)) return;
  state.nudged = false;
  state.nudgeKept = false;
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
 * - a strip-scrolling key press (`STRIP_SCROLLING_KEYS`, FUT-2862), a SIDEWAYS
 *   wheel, or the browser taking a pointer over to pan it (`pointercancel`),
 *   each armed until the next scroll under judgement has been judged.
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
    nudgedAt: Number.NaN,
    nudgeKept: false,
    undecided: false,
    scrolled: false,
    aimed: Number.NaN,
    quiet: undefined,
    settled: () => undefined,
    lastScrollLeft: physicalScrollLeft(strip),
    pointerDownAt: Number.NaN,
    pointerMoved: false,
    touchDownAt: Number.NaN,
    touchMoved: false,
  };
  const settle = (): void => settleJudgement(strip, state);
  const onScroll = (): void => {
    const now = physicalScrollLeft(strip);
    const movedFarEnough = Math.abs(now - state.lastScrollLeft) > SCROLL_DELTA_EPSILON;
    state.lastScrollLeft = now;
    // Pointer/touch need BOTH signals (FUT-2775): the pointer/finger must have
    // itself MOVED since going down, AND this tick's delta must be real. Either
    // alone still latches on the other's shape — a pointer merely resting on
    // the strip while its OWN `scrollTo` produces real per-tick deltas would
    // arm under a delta-only check (`pointerMoved`/`touchMoved` rules that out);
    // a pointer that drifts a sub-epsilon amount while resting would arm under
    // a moved-only check with no delta floor (`movedFarEnough` rules that out).
    dropStaleNudge(state);
    const pointerDrag = state.pointer && state.pointerMoved && movedFarEnough;
    const touchDrag = state.touch && state.touchMoved && movedFarEnough;
    // `nudged` (a keypress, a sideways wheel, the browser taking the pointer
    // over to pan) is already a discrete, one-shot gesture with no "resting
    // pointer coincides with an unrelated animation" shape to rule out — unlike
    // pointer/touch, requiring a delta on the SAME tick that arms it would only
    // race the strip's own scroll ending before a qualifying tick arrives (seen:
    // it broke the existing "keeps a wheel/drag scroll" stories against a real
    // browser's `scrollend` timing). So it arms as it always has.
    if (pointerDrag || touchDrag || state.nudged) state.undecided = true;
    if (!state.undecided || hasScrollEnd) return;
    // Every tick while undecided, armed or not: a quiet spell that began while
    // the strip was still moving would judge it mid-flight, away from its aim.
    clearTimeout(state.quiet);
    state.quiet = setTimeout(settle, QUIET_BEFORE_SETTLED_MS);
  };
  const gestures = createGestureListeners(state);
  const onStrip: Listeners = [...gestures.onStrip, ['scroll', onScroll], ['scrollend', settle]];
  const onView = gestures.onView;
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
