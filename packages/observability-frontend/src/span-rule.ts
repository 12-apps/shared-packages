/**
 * The host's rule for page names and URL paths on performance spans (FUT-2951).
 *
 * The eager half of span scrubbing: only the registration lives here, so a host
 * can call `setSpanTextScrubber` before `startObservability` without pulling
 * the scrub itself onto the critical path. `span-scrub.ts` applies the rule,
 * and it loads with the Web Vitals, after `load`: no span exists before that.
 */

/**
 * Replace whatever in a page name or a URL PATH identifies someone. It receives
 * a span name (a route or a path) or the pathname of a URL, never an origin.
 */
export type SpanTextScrubber = (text: string) => string;

const identity: SpanTextScrubber = (text) => text;
const rule: { current: SpanTextScrubber } = { current: identity };

/**
 * Register the host's rule for page names and paths. Call it before
 * `startObservability`, like `setErrorClassifiers`.
 */
export function setSpanTextScrubber(scrubber: SpanTextScrubber): void {
  rule.current = scrubber;
}

/** Test seam: back to the identity rule. */
export function resetSpanTextScrubberForTests(): void {
  rule.current = identity;
}

/** The rule in force now. */
export const spanTextRule = (): SpanTextScrubber => rule.current;
