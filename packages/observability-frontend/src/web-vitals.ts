/**
 * Web Vitals — LCP, INP and CLS — as streamed spans (FUT-2951).
 *
 * Its own module so the caller can `import()` it: the two integrations are
 * code a first paint never needs, and loading them after the page has painted
 * keeps them off the critical path. That is safe for LCP and CLS, whose
 * PerformanceObservers subscribe with `buffered: true` and so still see the
 * entries recorded before they ran; INP only counts interactions from the
 * moment its listener is registered, which after `load` misses at most the
 * taps a shopper makes while the page is still arriving.
 *
 * Both integrations are needed: `webVitalsIntegration` records the vitals as
 * spans, and `spanStreamingIntegration` is what buffers and sends a streamed
 * span. The client must already run with `traceLifecycle: "stream"` and a
 * `withStreamedSpan` `beforeSendSpan`, which `startObservability` sets.
 */
import { addIntegration, spanStreamingIntegration, webVitalsIntegration } from "@sentry/react";

export function installWebVitals(): void {
  addIntegration(spanStreamingIntegration());
  addIntegration(webVitalsIntegration());
}
