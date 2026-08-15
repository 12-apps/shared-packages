/**
 * Service-worker registration at app boot (12-23).
 *
 * A registered worker is a PRECONDITION for installability, so this has to run
 * on every visit — not from a settings screen somebody has to find. The origin host
 * learned that the hard way: its worker was registered only by
 * `enableWebPush()`, so a visitor who never opened notification preferences had
 * no worker at all and the browser never offered to install the store. The whole
 * PWA feature was gated on finding a settings page.
 *
 * Registration is idempotent, so a later `register()` from a push-permission
 * flow keeps working — the browser hands back the same registration.
 */

/** Whether this browser can host a worker at all. */
function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export interface RegisterServiceWorkerOptions {
  /** The worker script's URL. Default `/sw.js`. */
  path?: string;
  /**
   * The scope to claim. Default `/` — one worker covering every SPA route. The
   * default scope would be the SCRIPT'S OWN DIRECTORY, which for a worker served
   * from anywhere but the root silently covers almost nothing.
   */
  scope?: string;
}

/**
 * Register the app's worker.
 *
 * Deliberately fire-and-forget and deliberately silent on failure: a worker is
 * an enhancement, and a browser that refuses one (private mode, an insecure
 * origin, a user policy) must still get a perfectly working app. Nothing
 * downstream branches on the result, so surfacing an error would only be noise.
 *
 * Registered after `load`, not during boot: registration competes for the same
 * connection pool as the page's own chunks, and winning that race costs the
 * visitor first paint in exchange for a background task nothing is waiting on.
 */
export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): void {
  if (!supported()) return;
  const path = options.path ?? "/sw.js";
  const scope = options.scope ?? "/";
  const start = (): void => {
    navigator.serviceWorker.register(path, { scope }).catch(() => undefined);
  };
  if (typeof document === "undefined" || document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

/**
 * Post a message to the ACTIVE worker, if there is one.
 *
 * The generic half of the origin host's push-icon handoff: a worker is terminated
 * between events and a push arrives with no page open, so anything the worker
 * needs to know at delivery time has to have been told while someone was
 * looking. Silently does nothing when no worker is active yet — the common case
 * on a first visit, where the next navigation says it again.
 */
export function postToServiceWorker(message: unknown): void {
  if (!supported()) return;
  navigator.serviceWorker
    .getRegistration()
    .then((registration) => {
      registration?.active?.postMessage(message);
    })
    .catch(() => undefined);
}
