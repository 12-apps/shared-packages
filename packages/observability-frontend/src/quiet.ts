/**
 * When the SDK may start downloading: once the page's own downloads are done
 * (FUT-1023).
 *
 * `load` is too early for a single-page app. It fires when the document's
 * scripts are in, which on the storefront is BEFORE the route's chunks and the
 * first screen's data are even requested. Fetching the SDK there, measured on
 * the entry-level-phone harness at slow-3g, took the 28 KB it saved from the
 * entry chunk straight back from the route and the menu fetch: the first screen
 * was no sooner, and on some doors later.
 *
 * So the SDK waits for the network to go QUIET after `load`: no resource
 * finishing for {@link QUIET_MS}, read from the resource timing entries. It
 * never waits past {@link CAP_MS} after `load`, since a page that streams
 * images or polls would otherwise never qualify. Where the browser cannot
 * report resource timing, the quiet window runs from `load` alone.
 *
 * A request that takes longer than the window with nothing else finishing
 * reads as quiet. That costs the SDK sharing the tail of one slow request,
 * which is the case the cap exists for anyway.
 */

/** No resource finished for this long: the page is done downloading. */
const QUIET_MS = 3000;

/** The latest, after `load`, the SDK waits for quiet. */
const CAP_MS = 20_000;

let limits = { quietMs: QUIET_MS, capMs: CAP_MS };

/** Run `task` once the page has loaded. */
function afterLoad(task: () => void): void {
  if (typeof window === "undefined") return;
  if (document.readyState === "complete") {
    task();
    return;
  }
  window.addEventListener("load", task, { once: true });
}

function observeResources(onEntry: () => void): PerformanceObserver | null {
  const Observer = typeof PerformanceObserver === "undefined" ? undefined : PerformanceObserver;
  if (!Observer?.supportedEntryTypes?.includes("resource")) return null;
  const observer = new Observer(onEntry);
  observer.observe({ type: "resource" });
  return observer;
}

/** Resolves once the page has loaded and its downloads have gone quiet. */
export function whenNetworkQuiet(): Promise<void> {
  const { quietMs, capMs } = limits;
  return new Promise((resolve) => {
    afterLoad(() => {
      let quiet: ReturnType<typeof setTimeout> | undefined;
      let observer: PerformanceObserver | null = null;
      const done = (): void => {
        clearTimeout(quiet);
        clearTimeout(cap);
        observer?.disconnect();
        resolve();
      };
      const arm = (): void => {
        clearTimeout(quiet);
        quiet = setTimeout(done, quietMs);
      };
      const cap = setTimeout(done, capMs);
      observer = observeResources(arm);
      arm();
    });
  });
}

/** Test seam: shorten or restore the windows. */
export function setQuietWindowForTests(next: { quietMs: number; capMs: number } | null): void {
  limits = next ?? { quietMs: QUIET_MS, capMs: CAP_MS };
}
