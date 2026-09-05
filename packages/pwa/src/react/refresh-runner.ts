/**
 * Painting a frame, and running a refresh to its end (12-61).
 *
 * Split out of `pull-to-refresh.tsx` so the touch handlers stay about WHICH
 * touches belong to us, and this stays about what happens once one does. The
 * two halves fail differently and are easier to reason about apart.
 */
import type { PullGeometry } from "../pull-gesture";
import { reloadApp } from "../reload";
import type { PullIndicatorPhase } from "./pull-indicator";

/**
 * Writes the frame. One imperative call drives translate, opacity and rotation.
 *
 * `dragging` suppresses the chip's own transition: while the finger is down the
 * position IS the finger, and easing towards it puts the chip a frame behind.
 * Between gestures the transition is what animates the chip away, or down to
 * the spinner’s resting place.
 */
export function paint(
  node: HTMLElement | null,
  distance: number,
  thresholdPx: number,
  dragging: boolean,
): void {
  if (node === null) return;
  const progress = Math.min(1, distance / thresholdPx);
  node.dataset.dragging = String(dragging);
  node.style.setProperty("--pwa-ptr-y", `${distance}px`);
  node.style.setProperty("--pwa-ptr-opacity", String(progress));
  node.style.setProperty("--pwa-ptr-progress", String(progress));
}

/**
 * The longest a refresh may hold the spinner before the gesture takes itself
 * back. Only a host callback that never settles ever reaches it.
 */
const STUCK_REFRESH_MS = 15_000;

/** What {@link startRefresh} needs from the mount that owns the gesture. */
export interface RefreshDeps {
  chip: () => HTMLElement | null;
  latest: {
    current: {
      geometry: PullGeometry;
      phase: PullIndicatorPhase;
      onRefresh?: () => void | Promise<unknown>;
      onDiagnostic?: (message: string, context?: Record<string, unknown>) => void;
    };
  };
  setPhase: (phase: PullIndicatorPhase) => void;
  /** The mount's own settle. `force` bypasses the refresh latch. */
  settle: (force?: boolean) => void;
}

/** Show the spinner, run the host's refresh, and always give the chip back. */
export function startRefresh({ chip, latest, setPhase, settle }: RefreshDeps): void {
  const { thresholdPx } = latest.current.geometry;
  setPhase("refreshing");
  paint(chip(), thresholdPx, thresholdPx, false);
  const handler = latest.current.onRefresh ?? ((): Promise<void> => reloadApp());
  // The async wrapper is load-bearing: `Promise.resolve(handler())` evaluates
  // `handler()` FIRST, so a host whose callback throws synchronously escapes
  // before `.finally` is attached — and the "refreshing" latch then refuses
  // every later gesture for the life of the mount. Inside an async function the
  // same throw becomes a rejection this chain can see.
  const running = (async () => handler())();
  // A promise that never settles would latch just as permanently, so the
  // spinner has an outside edge. Generous on purpose: the default path is
  // replacing the document and will never reach it.
  const bail = setTimeout(() => settle(true), STUCK_REFRESH_MS);
  running
    .catch((error: unknown) => {
      latest.current.onDiagnostic?.("pwa: pull-to-refresh failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    })
    // On the default path the document is already being replaced and this never
    // runs, which is exactly right: the spinner must not blink off a frame
    // before the new page paints.
    .finally(() => {
      clearTimeout(bail);
      settle(true);
    });
}
