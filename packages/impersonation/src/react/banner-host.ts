/**
 * "IF THE BANNER CANNOT RENDER, THE SESSION MUST NOT START" — made into
 * something a machine checks rather than something a comment asserts.
 *
 * WHERE THIS CHECK BELONGS, and why it is here and not in the backend. The
 * server cannot see the DOM: at the moment the start request runs there is no
 * page to interrogate, and a route that tried to require one would be trusting a
 * header the caller writes. The browser CAN see it — so the precondition lives
 * at the ENTRY POINT, in the document that is about to start a session, and it
 * is evidence rather than assumption:
 *
 *   1. BEFORE the request — at least one banner host is mounted in this
 *      document. No host, no request; nothing is started.
 *   2. AFTER the request — a host actually PAINTED an active bar, within
 *      {@link BANNER_PAINT_TIMEOUT_MS}. If it did not (the component threw, the
 *      state read never came back, somebody unmounted the chrome), the session
 *      is ENDED immediately and the caller is told it did not start.
 *
 * Step 2 is what makes the rule true rather than merely attempted: "must not
 * start" is unachievable as a pre-check alone, because rendering happens after
 * the cookie exists. A session that failed to become visible is therefore
 * un-started retroactively, in the same call, before anyone can act inside it.
 *
 * The check is meaningful ACROSS tabs too, even though this registry is
 * per-document: the cookie is `path=/` on a single origin, so every app on that
 * origin sees it, and every one of them mounts the same banner in its chrome.
 * The console that starts a session therefore shows the bar itself — which is
 * precisely the document this registry can observe.
 *
 * A plain module registry, not React context: the starter is a page and the
 * renderer is app chrome, and making them share a provider would turn a safety
 * property into a question of where somebody mounted a component.
 */

/** How long a start waits for the bar to paint before undoing itself. */
const BANNER_PAINT_TIMEOUT_MS = 5000;

/**
 * Mutable module state, held on ONE container object rather than as
 * reassignable bindings — the shape flakiness linting pushes every mutable
 * module-scope value into, and it keeps this testable without exposing a setter
 * nobody should call.
 */
const registry = { mounted: 0, painted: false };

/** Waiters parked in {@link waitForPaintedBanner}. */
const waiters = new Set<() => void>();

/**
 * Record that a banner host has mounted; the returned function unregisters it.
 *
 * The count is a count, not a boolean: React can mount the next host before
 * unmounting the previous one (a shell swap, StrictMode's double-invoke), and a
 * boolean would report "no banner" for the frame in between — the exact instant
 * a start would be refused for no reason.
 */
export function registerBannerHost(): () => void {
  registry.mounted += 1;
  return () => {
    registry.mounted = Math.max(0, registry.mounted - 1);
    if (registry.mounted === 0) registry.painted = false;
  };
}

/** Is there a mounted banner host in this document? */
export function bannerHostMounted(): boolean {
  return registry.mounted > 0;
}

/**
 * Report whether a host currently has an ACTIVE bar on screen.
 *
 * Called by the banner on every change of that fact, so the flag describes what
 * is painted now and not what was once painted.
 */
export function reportBannerPainted(painted: boolean): void {
  registry.painted = painted;
  if (!painted) return;
  for (const waiter of [...waiters]) waiter();
}

/**
 * Resolve true once an active bar is on screen, false if `timeoutMs` passes
 * first (or there is no host at all to paint one).
 *
 * Resolves synchronously when the bar is ALREADY painted, which is the ordinary
 * case for a start made from a document that was already showing an earlier
 * session — and the reason this is a poll of state rather than a bare event
 * subscription, which would hang forever on the notification it already missed.
 */
export function waitForPaintedBanner(
  timeoutMs = BANNER_PAINT_TIMEOUT_MS,
): Promise<boolean> {
  if (registry.painted) return Promise.resolve(true);
  if (registry.mounted === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const settle = (value: boolean): void => {
      waiters.delete(onPaint);
      clearTimeout(timer);
      resolve(value);
    };
    function onPaint(): void {
      settle(true);
    }
    const timer = setTimeout(() => settle(false), timeoutMs);
    waiters.add(onPaint);
  });
}
