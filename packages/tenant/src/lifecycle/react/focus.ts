/**
 * Keep the person's place when a state change takes away the control they
 * pressed: the archive's entry, the restore, a reopen. The opener is gone, so
 * the overlay or dialog that closes cannot hand focus back to it, and focus
 * would fall to `<body>`.
 */
import { useEffect, useRef } from 'react';

/** How long a lost focus is watched for after the change: an overlay's exit transition, and some. */
const WATCH_MS = 1_000;
const STEP_MS = 16;

/** Focus fell nowhere: on the body, or on a node no longer in the page. */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * When `state` changes under a mounted component (never on its first render,
 * nor from `''`, a state not known yet),
 * focus what `target()` answers. A dialog may still hold focus at that moment
 * and drop it to `<body>` when it closes, so for a moment after the change a
 * lost focus is sent to the target again. A focus the person moved somewhere
 * else is never taken.
 */
export function useFocusOnChange(state: string, target: () => HTMLElement | null): void {
  const seen = useRef<string | null>(null);
  const find = useRef(target);
  find.current = target;
  useEffect(() => {
    const before = seen.current;
    seen.current = state;
    if (before === null || before === '' || before === state) return undefined;
    find.current()?.focus();
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += STEP_MS;
      if (focusIsLost()) find.current()?.focus();
      if (waited >= WATCH_MS) window.clearInterval(timer);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [state]);
}
