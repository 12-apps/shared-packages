/**
 * Pull down to reload — the reload an installed app took away (12-61).
 *
 * `@12-apps/pwa`'s adoption contract already names the failure this closes:
 * *"on an INSTALLED app 'force-refresh' is advice the user cannot follow"*. The
 * packaged worker fixes as much of that as a worker can (nothing stale is ever
 * pinned); this fixes the rest, by giving the person holding the phone the move
 * every other app on it has.
 *
 * ## It is inert unless the platform actually took the reload away
 *
 * Wrapping the app in this costs nothing on a device that already has a reload,
 * because on those devices nothing mounts: {@link needsPullToRefresh} is false
 * in every browser tab (address bar, and the browser's own overscroll refresh)
 * and false in a Chromium standalone app (which KEEPS that overscroll refresh).
 * It is true on iOS home-screen web apps and nowhere else, and adding a second
 * gesture on top of a working one is how an app reloads twice from one pull.
 *
 * ## Three things it must not break, and how each is prevented
 *
 * 1. **Scrolling.** The first {@link PullGeometry.engagePx} of travel are
 *    watched and not consumed — `preventDefault()` is called only once
 *    {@link createPullTracker} says the gesture is claimed, which it never says
 *    for a finger moving up or sideways.
 * 2. **Anything in a portal.** The listeners are on this component's own
 *    subtree rather than on `window`, so a drawer or a dialog — which MUI
 *    renders into `document.body`, a sibling of everything here — cannot reach
 *    them at all. That is a property of the tree, not a check somebody has to
 *    remember to write.
 * 3. **Nested scrollers and rails.** {@link pullBlockedBy} walks the ancestors
 *    at `touchstart` and stands down for anything already scrolled down, or
 *    marked `data-pull-refresh="off"`.
 *
 * ## Why the listeners are native and not JSX props
 *
 * React registers `touchstart` and `touchmove` on its root container as PASSIVE
 * listeners, and a passive listener's `preventDefault()` does nothing (bar a
 * console warning nobody sees on a phone). An `onTouchMove` prop would
 * therefore track the pull perfectly and fail to stop the page scrolling under
 * it. `addEventListener(..., { passive: false })` is the only version of this
 * that works.
 */
import { Box } from "@12-apps/ui/mui/Box";
import type { JSX, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { PullToRefreshMessages } from "../messages";
import {
  createPullTracker,
  type PullTracker,
  DEFAULT_PULL_GEOMETRY,
  documentAtTop,
  pullBlockedBy,
  type PullGeometry,
} from "../pull-gesture";
import { needsPullToRefresh } from "../reload";
import { acquireOverscrollLock } from "./overscroll-lock";
import { paint, startRefresh } from "./refresh-runner";
import { PullIndicator, type PullIndicatorPhase } from "./pull-indicator";

export interface PullToRefreshProps {
  children: ReactNode;
  /** Every string the gesture announces — the HOST's words, no defaults. */
  messages: PullToRefreshMessages;
  /**
   * The host's own gate, ANDed with the platform test. Default `true`.
   *
   * For a product rule ("not on the checkout screen"), never for a platform
   * one — that is what {@link PullToRefreshProps.platform} is.
   */
  enabled?: boolean;
  /**
   * Does this session need the gesture? Default {@link needsPullToRefresh}.
   *
   * Injectable because the platform question has more than one right answer.
   * {@link isInstalledHandheld} turns it on for every installed phone —
   * Android included, where it takes over from Chromium's own refresh rather
   * than doubling it (see `useOverscrollLock`). An end-to-end test drives a
   * desktop browser that can never satisfy the real test and needs
   * `() => true` to see the thing it is asserting.
   */
  platform?: () => boolean;
  /**
   * What a completed pull does. Default {@link reloadApp} — a real reload,
   * which is the point.
   *
   * A host with a query cache may prefer to refetch instead: return the
   * promise and the indicator spins until it settles. Note the two are not
   * equivalent — only a reload picks up a new deploy.
   */
  onRefresh?: () => void | Promise<unknown>;
  /** Distance from the top of the viewport the chip descends from. Default 0. */
  offsetTop?: number | string;
  /** Above the app's own fixed chrome. Default 1250 (MUI: drawer 1200, modal 1300). */
  zIndex?: number | string;
  /**
   * How far the pull has to travel. Read ONCE, when the gesture goes live —
   * the tracker is built with it and lives for the mount, so changing it
   * mid-session changes nothing until the component remounts.
   */
  geometry?: PullGeometry;
  /**
   * Told once per mount whether the gesture is live, and told again if a
   * refresh throws. A gesture that declines to exist fails SILENTLY — the app
   * looks perfectly healthy and simply never refreshes — so the decision has to
   * be able to reach the host's own error reporting.
   */
  onDiagnostic?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Hand the top overscroll to this component while it is live.
 *
 * `contain` rather than `none`, and the difference is the whole point: it turns
 * off the browser's own REFRESH gesture while leaving its visual overscroll —
 * the bounce, the glow — alone. `none` would take both, which on Android means
 * losing a cue the platform draws for free.
 *
 * It therefore does two jobs, depending on who is underneath:
 *
 * - **On iOS**, where there is no native refresh to switch off, it stops the
 *   document's scroll chaining while the gesture owns the top. The bounce is
 *   not what `contain` removes; what keeps the page still under a claimed pull
 *   is the `preventDefault` in `onMove`.
 * - **On Android**, where this only runs if the host opted in with
 *   {@link isInstalledHandheld}, it is exactly the property that switches
 *   Chromium's own overscroll refresh off — so the handover is clean and the
 *   user never gets two gestures for one pull.
 *
 * Set on BOTH elements because the engines disagree about which one carries it:
 * WebKit reads `html`, Chromium reads `body`.
 *
 * Scoped to the mount and restored on unmount, so a host that renders this on
 * some routes and not others does not leave the document altered behind it —
 * and if this bundle never runs at all, the property is never set and the
 * browser's own gesture is untouched. The failure direction is the safe one.
 */
function useOverscrollLock(active: boolean): void {
  useEffect(() => (active ? acquireOverscrollLock() : undefined), [active]);
}

/**
 * The platform decision, taken once on mount and reported once.
 *
 * In an effect rather than during render because `display-mode` and the user
 * agent are browser facts, and a host that ever renders this on a server must
 * agree with itself on the first client render.
 */
function useGestureActive(
  enabled: boolean,
  platform: () => boolean,
  onDiagnostic: PullToRefreshProps["onDiagnostic"],
): boolean {
  const [active, setActive] = useState(false);
  const reported = useRef(false);
  useEffect(() => {
    const supported = platform();
    setActive(enabled && supported);
    if (reported.current) return;
    reported.current = true;
    onDiagnostic?.("pwa: pull-to-refresh mounted", { enabled, supported });
  }, [enabled, platform, onDiagnostic]);
  return active;
}

/**
 * Everything the listeners share, gathered so they can live at module scope.
 *
 * `latest` is a ref rather than the values themselves: the listeners are
 * attached ONCE, and a parent re-rendering with a new inline `onRefresh` must
 * not tear four `addEventListener`s down and build them again mid-gesture.
 */
interface GestureContext {
  chip: () => HTMLDivElement | null;
  latest: { current: GestureConfig & { phase: PullIndicatorPhase } };
  setPhase: (phase: PullIndicatorPhase) => void;
}

interface GestureConfig {
  onRefresh: PullToRefreshProps["onRefresh"];
  onDiagnostic: PullToRefreshProps["onDiagnostic"];
  geometry: PullGeometry;
}

/**
 * One move of a sequence we own.
 *
 * Two ways to hand it back: a second finger (a pinch, and zooming while the
 * page is pinned by our `preventDefault` is a trap the user cannot escape), and
 * a move the platform will not let us cancel — which means a scroll it has
 * ALREADY started, since the first `engagePx` are deliberately not prevented
 * and that is the window WebKit's rubber band begins in. Claiming then would
 * paint our chip over the browser's own bounce and reload the document on a
 * gesture the user aimed at the page.
 */
function handleMove(
  event: TouchEvent,
  context: GestureContext,
  tracker: PullTracker,
  standDown: () => void,
): void {
  if (event.touches.length !== 1) return standDown();
  const touch = event.touches[0];
  if (!touch) return;
  const update = tracker.move({ x: touch.clientX, y: touch.clientY });
  if (!update.claimed) return;
  // Claim even when the platform will not let us cancel. Standing down here is
  // tempting — an uncancelable move means a scroll the browser has already
  // started, and our chip would sit over its own bounce — but it was MEASURED
  // to kill the gesture outright: in headless Chromium driven through CDP,
  // every touch event on a mounted gesture arrives `cancelable: false`, so the
  // stand-down refused all of them and nothing ever refreshed. The two failure
  // modes are not comparable. Claiming a move we cannot prevent costs one
  // cosmetic double-bounce; refusing costs the feature. Revisit only with a
  // measurement from a real iOS home-screen app.
  if (event.cancelable) event.preventDefault();
  context.setPhase(update.phase);
  paint(
    context.chip(),
    update.distance,
    context.latest.current.geometry.thresholdPx,
    true,
  );
}

/** The four touch handlers, bound to one host element and one tracker. */
function createHandlers(
  host: HTMLElement,
  context: GestureContext,
): Record<"start" | "move" | "end" | "cancel", (event: TouchEvent) => void> {
  const { chip, latest, setPhase } = context;
  const tracker = createPullTracker(latest.current.geometry);

  // A refresh in flight must survive a stray touch: `reloadApp` waits up to two
  // seconds for the worker, the page looks frozen, and clearing the latch would
  // hide the spinner AND re-open `start()`, so a second pull reloads again.
  const settle = (force = false): void => {
    if (!force && latest.current.phase === "refreshing") return;
    setPhase("idle");
    paint(chip(), 0, latest.current.geometry.thresholdPx, false);
  };

  /**
   * Give the sequence up: forget the claim AND put the chip away.
   *
   * Both halves, always. An earlier revision reset the tracker without
   * settling, which stranded a fully-opaque chip mid-screen — with
   * `data-dragging="true"`, so even the exit transition never ran — whenever a
   * second finger landed during an armed pull.
   */
  const standDown = (): void => {
    tracker.cancel();
    settle();
  };

  return {
    start(event) {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (
        latest.current.phase === "refreshing" ||
        !touch ||
        !documentAtTop() ||
        pullBlockedBy(event.target, host)
      ) {
        // Refusing RESETS, and that is the whole fix for the stale claim: a
        // sequence whose lift was lost leaves the tracker claimed, and without
        // this the next refused touch's lift would release it and reload the
        // app under a shopper who only tapped. `standDown` also settles, so a
        // refusal cannot leave the chip on screen.
        standDown();
        return;
      }
      tracker.begin({ x: touch.clientX, y: touch.clientY });
    },

    move: (event) => handleMove(event, context, tracker, standDown),

    end() {
      if (tracker.release()) startRefresh({ chip, latest, setPhase, settle });
      else settle();
    },

    cancel: standDown,
  };
}


/** Attaches the handlers to the host for as long as the gesture is live. */
function useTouchListeners(active: boolean, context: GestureContext): {
  hostRef: RefObject<HTMLDivElement | null>;
} {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!active || host === null) return undefined;
    const on = createHandlers(host, context);
    host.addEventListener("touchstart", on.start, { passive: true });
    // The one listener that MUST NOT be passive — see the note at the top.
    host.addEventListener("touchmove", on.move, { passive: false });
    host.addEventListener("touchend", on.end);
    host.addEventListener("touchcancel", on.cancel);
    return () => {
      host.removeEventListener("touchstart", on.start);
      host.removeEventListener("touchmove", on.move);
      host.removeEventListener("touchend", on.end);
      host.removeEventListener("touchcancel", on.cancel);
    };
    // `context` is refs and setters only — stable for the life of the mount, and
    // deliberately not a dependency: re-running this mid-gesture would drop the
    // tracker holding the pull the user is in the middle of.
  }, [active]);
  return { hostRef };
}

export function PullToRefresh({
  children,
  messages,
  enabled = true,
  platform = needsPullToRefresh,
  onRefresh,
  offsetTop = 0,
  zIndex = 1250,
  geometry = DEFAULT_PULL_GEOMETRY,
  onDiagnostic,
}: PullToRefreshProps): JSX.Element {
  const active = useGestureActive(enabled, platform, onDiagnostic);
  const chipRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<PullIndicatorPhase>("idle");
  useOverscrollLock(active);

  const latest = useRef({ onRefresh, onDiagnostic, geometry, phase });
  latest.current = { onRefresh, onDiagnostic, geometry, phase };
  const { hostRef } = useTouchListeners(active, {
    chip: () => chipRef.current,
    latest,
    setPhase,
  });

  return (
    // `display: contents` so wrapping an app in this changes no layout — the
    // children stay their parent's own flex/grid items — while still being a
    // real element in the tree, which is what the listeners (and the portal
    // isolation described above) need.
    <Box ref={hostRef} sx={{ display: "contents" }} data-testid="pull-to-refresh">
      {children}
      {active ? (
        <PullIndicator
          ref={chipRef}
          phase={phase}
          messages={messages}
          offsetTop={offsetTop}
          zIndex={zIndex}
        />
      ) : null}
    </Box>
  );
}
