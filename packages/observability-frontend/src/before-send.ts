/**
 * The filter every error event passes through before it leaves (FUT-717).
 *
 * Its own module so `index.ts`, which every SPA loads at boot, stays the
 * handlers, the buffer and the API: this half runs only once the SDK is up.
 */
import type * as SentryApi from "@sentry/react";

import { shouldReport, SOURCE_TAG } from "./noise";
import { scrub, scrubUrl } from "./scrub";

/** Best-effort text for the noise filter to match against. */
function describe(event: SentryApi.ErrorEvent, error: unknown): string {
  const values = event.exception?.values ?? [];
  const frames = values
    .flatMap((value) => value.stacktrace?.frames ?? [])
    .map((frame) => frame.filename ?? "")
    .join(" ");
  const message = error instanceof Error ? error.message : String(error ?? "");
  return [event.message ?? "", values.map((v) => v.value ?? "").join(" "), message, frames]
    .join(" ")
    .trim();
}

/**
 * The single choke point every event passes through, whoever produced it.
 *
 * Filtering at the call sites instead would miss the SDK's own global-handler
 * and breadcrumb instrumentation, which is where most events come from.
 */
export function beforeSend(
  event: SentryApi.ErrorEvent,
  hint: SentryApi.EventHint,
): SentryApi.ErrorEvent | null {
  const error = hint.originalException;
  const source = event.tags?.[SOURCE_TAG];
  if (!shouldReport(error, { text: describe(event, error), source: String(source ?? "") }).report) {
    return null;
  }

  // The request URL is evidence in its own right: a storefront path names the
  // store, and a query string is where tokens and e-mails end up.
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.url === "string") crumb.data.url = scrubUrl(crumb.data.url);
  }

  return scrub(event) as SentryApi.ErrorEvent;
}
