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
 * span. The client must already run with `traceLifecycle: "stream"`, which
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
  getClient,
  spanStreamingIntegration,
  webVitalsIntegration,
  withStreamedSpan,
} from "@sentry/react";

import { scrubSpan } from "./span-scrub";

export function installWebVitals(): void {
  const client = getClient();
  if (!client) return;
  client.getOptions().beforeSendSpan = withStreamedSpan(scrubSpan);
  addIntegration(spanStreamingIntegration());
  addIntegration(webVitalsIntegration());
}
