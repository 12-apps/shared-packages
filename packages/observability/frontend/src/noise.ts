/**
 * What must never become a Sentry issue.
 *
 * A reporter that shouts on every deploy gets muted in its first week, and a
 * muted reporter is worse than none — it costs money and it teaches people to
 * ignore the tab. So this file is the one that decides whether the whole
 * feature survives contact with production.
 *
 * Three classes, each traceable to a mechanism already in this repo.
 */

/**
 * Marks an event as having come from the route error boundary rather than from
 * a global handler. Read by {@link shouldReport} to decide the chunk-load case.
 */
export const SOURCE_TAG = "error.source";
export const SOURCE_ROUTE_BOUNDARY = "route-boundary";

/**
 * Messages that are never our bug.
 *
 * - `ResizeObserver loop …` — fired by browsers when observers settle across
 *   frames. Benign, unfixable from application code, and high-volume.
 * - `Script error.` — a cross-origin script failed and the browser withheld
 *   the detail. There is no stack and no file, so the event carries nothing
 *   actionable; it groups everything unrelated under one heading.
 * - The extension schemes — code injected into the page by a browser add-on.
 *   It is not shipped by us and cannot be fixed by us.
 */
const NEVER_OURS = [
  /resizeobserver loop/i,
  /^script error\.?$/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-(web-)?extension:\/\//i,
  // Sentry's own wording when something threw a non-Error with no useful body.
  /non-error promise rejection captured with value: undefined/i,
];

/** Whether the failing frame belongs to a browser extension rather than to us. */
function fromExtension(text: string): boolean {
  return /(chrome|moz|safari(-web)?)-extension:\/\//i.test(text);
}

interface ReportDecision {
  report: boolean;
  /** Why it was dropped — surfaced in tests so the rule is named, not guessed. */
  reason?: string;
}

/**
 * The single choke point, applied in `beforeSend` so it sees EVERY event —
 * the ones we capture by hand and the ones the SDK's own global handlers
 * produce. Filtering at the call sites instead would silently miss the second
 * group, which is most of them.
 */
/**
 * The wordings browsers and bundlers use when a hashed chunk has gone.
 *
 * Kept in the package rather than injected: these are Chrome's, Safari's and
 * Vite's strings, not any one product's. Splitting them across the host seam
 * is how you end up dropping one browser's wording and reporting another's —
 * the same bug filed once per Safari user and never once per Chrome user.
 *
 * The host's `isStaleChunk` classifier stacks ON TOP of this, for loaders that
 * throw a typed error rather than a recognisable message.
 */
const STALE_CHUNK_WORDINGS = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /error loading dynamically imported module/i,
];

function isStaleChunkWording(text: string): boolean {
  return STALE_CHUNK_WORDINGS.some((pattern) => pattern.test(text));
}

/**
 * What the HOST knows about its own errors, and this package cannot.
 *
 * Two classifications decide most of the noise, and both are host-specific:
 * what counts as a routine non-5xx API answer (which depends on that app's HTTP
 * client and its error type), and what a stale-chunk failure looks like (which
 * depends on its lazy-route strategy). Injecting them keeps the noise RULES —
 * the part worth sharing — separate from the app details they key off.
 *
 * Both default to "no", so a host that wires neither still gets the
 * extension/ResizeObserver filtering and simply reports the rest.
 */
export interface ErrorClassifiers {
  /** A clean 4xx: a normal answer, not a failure. A 5xx must NOT match. */
  isIgnorableResponse?: (error: unknown) => boolean;
  /** A chunk that died with the deploy that produced it. */
  isStaleChunk?: (error: unknown) => boolean;
}

let classifiers: ErrorClassifiers = {};

/** Install the host's classifiers. Called once, from the host's adapter. */
export function setErrorClassifiers(next: ErrorClassifiers): void {
  classifiers = next;
}

/** Test seam: forget the host's classifiers. */
export function resetErrorClassifiersForTests(): void {
  classifiers = {};
}

export function shouldReport(
  error: unknown,
  context: { text: string; source?: string },
): ReportDecision {
  const { text, source } = context;

  if (NEVER_OURS.some((pattern) => pattern.test(text)) || fromExtension(text)) {
    return { report: false, reason: "not-our-code" };
  }

  // ── A clean 4xx is a normal answer, not a failure ───────────────────────
  //
  // The host's HTTP client throws for any non-2xx, so an empty cart
  // (`400 EMPTY_CART`) arrives here looking exactly like a crash. The server
  // reporter already fixed this rule for itself: "A clean 4xx is not an error."
  // A 5xx passes — but note the server has usually reported that same failure
  // already, so the browser copy is a duplicate by design, kept because it
  // carries what the user was doing.
  if (classifiers.isIgnorableResponse?.(error) === true) {
    return { report: false, reason: "client-error-response" };
  }

  // ── Stale chunks after a deploy ─────────────────────────────────────────
  //
  // Every hashed filename dies with the deploy that produced it, so every tab
  // opened beforehand requests a chunk that is gone. That is not a bug — it is
  // `lazy-route.ts` working — and it fires in EVERY open tab on EVERY deploy.
  // The storefront is installable, so its tabs live for days and it would be
  // the loudest of the three.
  //
  // The distinction that matters: `loadRouteChunk` already swallows the FIRST
  // failure (it reloads and returns a promise that never settles), so a chunk
  // error which reaches the ROUTE BOUNDARY has by definition already survived
  // that recovery — the reload did not fix it, and it is worth a look. One
  // arriving anywhere else has not been through recovery and is ordinary
  // deploy churn.
  if (classifiers.isStaleChunk?.(error) === true || isStaleChunkWording(text)) {
    return source === SOURCE_ROUTE_BOUNDARY
      ? { report: true }
      : { report: false, reason: "stale-chunk-recovered" };
  }

  return { report: true };
}
