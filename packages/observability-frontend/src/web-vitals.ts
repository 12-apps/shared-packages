/**
 * Web Vitals — LCP, INP and CLS — as streamed spans (FUT-2951).
 *
 * Its own module so the caller can `import()` it: this is code a first paint
 * never needs, and loading it after the page has painted keeps it off the
 * critical path. That is safe for LCP and CLS, whose PerformanceObservers
 * subscribe with `buffered: true` and so still see the entries recorded before
 * they ran; INP only counts interactions from the moment its listener is
 * registered, which after `load` misses at most the taps a shopper makes while
 * the page is still arriving.
 *
 * ## Why `browserTracingIntegration`, and why so little of it
 *
 * `webVitalsIntegration` alone sends INP and nothing else: it reports LCP and
 * CLS against the PAGELOAD span (`listenForWebVitalReportEvents` only runs its
 * collector once `afterStartPageLoadSpan` has handed it one), and only
 * `browserTracingIntegration` starts that span. Measured on the adopting
 * storefront: with `webVitalsIntegration` alone, one INP span and no LCP or
 * CLS ever left the page. `browserTracingIntegration` adds `webVitalsIntegration`
 * itself and starts the pageload span at the navigation's `timeOrigin`, so a
 * late install still measures the whole load.
 *
 * Everything else it can do is switched off, because at a rate of 1 every one
 * of those spans is billed and none of them is a vital:
 *
 * - **No request spans** (`traceFetch`, `traceXHR`), which also means no
 *   `sentry-trace`/`baggage` headers on the host's own API calls.
 * - **No resource spans**: one per script, stylesheet and image the page loads.
 * - **No long tasks, long animation frames, marks or measures.**
 * - **No navigation spans**: a page load, not every client-side route change.
 *
 * `spanStreamingIntegration` is what buffers and sends a streamed span. The
 * client must already run with `traceLifecycle: "stream"`, which
 * `startObservability` sets.
 *
 * The scrubbing hook is installed HERE, first, rather than at `init`: it is the
 * one place every streamed span leaves through, and no span exists before
 * these integrations do, so installing it with them keeps the scrub off the
 * critical path without a span ever leaving unscrubbed. Sentry reads
 * `beforeSendSpan` from the live client options on every span
 * (`captureSpan`), which is what makes a late install take effect.
 */
import {
  addIntegration,
  browserTracingIntegration,
  getClient,
  spanStreamingIntegration,
  withStreamedSpan,
} from "@sentry/react";

import { scrubSpan } from "./span-scrub";

/** Every `resource.<initiatorType>` op the browser metrics can produce. */
const RESOURCE_SPAN_OPS = [
  "script",
  "link",
  "css",
  "img",
  "image",
  "other",
  "beacon",
  "iframe",
  "video",
  "audio",
  "track",
  "input",
  "body",
  "navigation",
  "early-hints",
].map((type) => `resource.${type}`);

export function installWebVitals(): void {
  const client = getClient();
  if (!client) return;
  client.getOptions().beforeSendSpan = withStreamedSpan(scrubSpan);
  addIntegration(spanStreamingIntegration());
  addIntegration(
    browserTracingIntegration({
      instrumentNavigation: false,
      traceFetch: false,
      traceXHR: false,
      enableLongTask: false,
      enableLongAnimationFrame: false,
      ignoreResourceSpans: RESOURCE_SPAN_OPS,
      ignorePerformanceApiSpans: [/./],
      linkPreviousTrace: "off",
    }),
  );
}
