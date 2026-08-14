/**
 * "The tab just woke up" — the one browser signal both halves of the banner have
 * to react to.
 *
 * A laptop that slept for two hours fires no timers while it is asleep and
 * dispatches no network activity, so a banner that only ticks on an interval
 * comes back showing a countdown frozen at whatever it read before the lid
 * closed — the single most dangerous thing this bar could display, because it
 * says a session is still running that the server closed long ago.
 *
 * Both listeners are registered, not one: `visibilitychange` covers a
 * backgrounded tab in a window that stayed focused, `focus` covers a foreground
 * tab in a window that did not. Neither subsumes the other, and a duplicate call
 * is free (the countdown recomputes from the clock, the state re-reads).
 */

/** Run `handler` whenever this tab becomes visible or the window regains focus. */
export function subscribeToWake(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', handler);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', handler);
  };
}
