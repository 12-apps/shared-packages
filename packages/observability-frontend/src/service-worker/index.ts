/**
 * Error reporting for a SERVICE WORKER.
 *
 * ## Why a worker needs its own entry at all
 *
 * A service worker is a separate global scope. The page's `window.onerror`,
 * its `unhandledrejection` handler and its React boundary never see anything a
 * worker throws — so an app can have the full browser half of this package
 * wired up and still be completely blind to its worker.
 *
 * That blindness lands on the worst code in the app. A worker's caching
 * strategy decides whether a deploy bricks an installed PWA: pin the wrong
 * document and every hashed chunk it names is gone, the recovery reload runs
 * against the cache, and the user is left on a blank screen with "force
 * refresh" as advice they cannot follow. A `QuotaExceededError` swallowed by a
 * `cache.put(...).catch(() => undefined)` breaks offline silently. None of it
 * reaches a page.
 *
 * ## Why it ships as a separate, IIFE build
 *
 * A classic worker — `navigator.serviceWorker.register("/sw.js")` with no
 * `{ type: "module" }` — can only pull in code through `importScripts()`, which
 * is synchronous and takes a URL, not a module specifier. So this entry is
 * built to a self-contained IIFE the host serves from its own origin:
 *
 * ```js
 * importScripts("/observability-sw.js");
 * observability.installWorkerReporter({ app: "storefront" });
 * ```
 *
 * It is the third consumer in this package that needs its own build format, for
 * the same underlying reason each time — what LOADS the code decides what the
 * code must be. Application source is compiled by a bundler and takes `.tsx`;
 * a `vite.config.ts` is executed by Node and takes compiled ESM; a classic
 * worker takes a classic script.
 *
 * ## What it deliberately does not do
 *
 * No SDK. `@sentry/react` assumes a document, and a worker has none. This talks
 * to Sentry's envelope endpoint directly, which is a small and stable surface —
 * and buys the ability to report from a scope the SDK does not support at all.
 */
import { loadObservabilityConfig, DEFAULT_CONFIG_ENDPOINT } from "../config";
import { scrub, scrubUrl } from "../scrub";

/** What the host tells us once, from inside its worker. */
export interface WorkerReporterOptions {
  /** The `?app=` value — which app's DSN to ask for. */
  app: string;
  /** Where the config lives. Defaults to {@link DEFAULT_CONFIG_ENDPOINT}. */
  endpoint?: string;
  /**
   * Cap on events sent per worker INSTANCE. Default 5.
   *
   * A worker is short-lived and event-driven, so a loop in a handler can fire
   * hundreds of times in a second. The cap is what stops one bad deploy from
   * spending the org's quota before anybody notices; the counter resets
   * naturally when the browser terminates the worker.
   */
  maxEvents?: number;
}

/** Extra context on a hand-reported failure. */
export interface WorkerErrorContext {
  /** Which handler it came from — becomes a Sentry tag: `install`, `fetch`, … */
  handler?: string;
  /** A URL involved. Query string and fragment are stripped before sending. */
  url?: string;
  /** Anything else worth having. Scrubbed by key, like every other payload. */
  extra?: Record<string, unknown>;
}

interface ParsedDsn {
  key: string;
  host: string;
  projectId: string;
}

let options: WorkerReporterOptions | null = null;
let sent = 0;
/** `undefined` = not asked yet; `null` = asked, reporting is off. */
let config: Awaited<ReturnType<typeof loadObservabilityConfig>> | undefined;

/**
 * `https://<key>@<host>/<projectId>` → its parts.
 *
 * Hand-parsed rather than via `new URL`: the public key sits in the userinfo
 * position, and reading `username` off a parsed URL is both less obvious and
 * less portable than the one expression this needs.
 */
function parseDsn(dsn: string): ParsedDsn | null {
  const match = /^https:\/\/([^@:/]+)@([^/]+)\/(\d+)\/?$/.exec(dsn);
  if (!match) return null;
  return { key: match[1] as string, host: match[2] as string, projectId: match[3] as string };
}

/**
 * A failed request is a worker's normal weather, not a defect.
 *
 * Offline is the condition this code exists to survive, and every strategy in a
 * caching worker is built around `fetch` rejecting. Reporting those would file
 * an issue every time somebody walks into a lift — and would bury the caching
 * bugs that are the actual reason for any of this.
 *
 * The wordings differ per browser: Safari says `Load failed` for any failed
 * fetch, Chrome `Failed to fetch`, Firefox `NetworkError when attempting…`.
 */
const NETWORK_FAILURE = /load failed|failed to fetch|networkerror|network ?request failed/i;

function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NETWORK_FAILURE.test(message);
}

/** The config, fetched at most once per worker instance. */
async function reportingConfig(): Promise<Awaited<ReturnType<typeof loadObservabilityConfig>>> {
  if (config !== undefined) return config;
  const current = options;
  if (!current) {
    config = null;
    return config;
  }
  // Not persisted to the Cache API, unlike the push icon next to it in a
  // typical worker. A push must render instantly with no page, so it cannot
  // afford a round-trip; an error report can, and paying it fresh each time the
  // worker wakes is what keeps a rotated DSN from being remembered forever.
  config = await loadObservabilityConfig(current.app, current.endpoint ?? DEFAULT_CONFIG_ENDPOINT);
  return config;
}

function buildEnvelope(
  dsn: ParsedDsn,
  payload: Record<string, unknown>,
  eventId: string,
): { url: string; body: string } {
  const url = `https://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.key}&sentry_version=7`;
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(payload),
  ].join("\n");
  return { url, body };
}

/**
 * Report a failure from inside a worker.
 *
 * Never throws and never rejects: a reporter that can fail its own caller would
 * turn a logged problem into a broken fetch handler, which in this file means a
 * broken page.
 */
export function reportWorkerError(error: unknown, context: WorkerErrorContext = {}): void {
  void send(error, context).catch(() => undefined);
}

/** What the event body looks like once the error has been taken apart. */
function buildEventPayload(
  eventId: string,
  error: unknown,
  settings: { environment: string; release: string },
  context: WorkerErrorContext,
): Record<string, unknown> {
  const failure = error instanceof Error ? error : undefined;
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    logger: "service-worker",
    environment: settings.environment,
    release: settings.release,
    // The tag that makes these findable — and separable — from page errors.
    // A worker failure and a render crash want different people looking.
    tags: { source: "service-worker", handler: context.handler ?? "unknown" },
    exception: {
      values: [{ type: failure?.name ?? "Error", value: failure?.message ?? String(error) }],
    },
    // The stack goes in `extra`, not as parsed frames. A worker script is
    // served verbatim and unminified, so `sw.js:118` in the raw text is already
    // the answer — and hand-writing a per-browser stack parser here would be a
    // second surface to get wrong inside the code that reports failures.
    extra: scrub({
      ...(failure?.stack ? { stack: failure.stack } : {}),
      ...(context.url ? { url: scrubUrl(context.url) } : {}),
      ...context.extra,
    }) as Record<string, unknown>,
  };
}

/**
 * Whether this call has already earned a refusal, before any I/O happens.
 *
 * Both checks are synchronous on purpose — see the slot claim in {@link send}.
 */
function suppressed(error: unknown, current: WorkerReporterOptions): boolean {
  return isNetworkFailure(error) || sent >= (current.maxEvents ?? 5);
}

async function send(error: unknown, context: WorkerErrorContext): Promise<void> {
  const current = options;
  if (!current || suppressed(error, current)) return;

  // Claim the slot BEFORE the first await, not after the send.
  //
  // The cap exists for a handler that fails in a loop — dozens of calls in one
  // tick. Every one of those runs synchronously up to the first `await`, so a
  // counter incremented after it would let all of them past the check first and
  // cap nothing at all, precisely in the case it was written for.
  //
  // A slot spent on a report that then finds no DSN is not worth reclaiming: if
  // the config is absent once, it is absent for this whole worker instance, so
  // there is nothing left for the slot to be spent on.
  sent += 1;

  const settings = await reportingConfig();
  if (!settings) return;
  const dsn = parseDsn(settings.dsn);
  if (!dsn) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const payload = buildEventPayload(eventId, error, settings, context);

  const { url, body } = buildEnvelope(dsn, payload, eventId);
  await fetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-sentry-envelope" },
    // Cross-origin and credential-free: the ingest endpoint takes the public
    // key in the query string and must never receive this origin's cookies.
    credentials: "omit",
    // The worker can be terminated the instant its handler settles. Without
    // this the report dies with it — precisely when a crash is what killed it.
    keepalive: true,
  });
}

/**
 * Wire the worker's global handlers. Call once, at the top of the worker.
 *
 * ```js
 * importScripts("/observability-sw.js");
 * observability.installWorkerReporter({ app: "storefront" });
 * ```
 *
 * The two listeners cover anything that escapes: a throw in a handler surfaces
 * as `error`, and a rejected promise handed to `event.waitUntil` or
 * `event.respondWith` surfaces as `unhandledrejection`. Failures the worker
 * SWALLOWS on purpose — the `catch(() => undefined)` that keeps a bad install
 * from leaving a page with no worker at all — reach neither, and are exactly
 * what {@link reportWorkerError} is for.
 */
export function installWorkerReporter(next: WorkerReporterOptions): void {
  options = next;
  const scope = self as unknown as {
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
  };

  scope.addEventListener("error", (event) => {
    const detail = event as { error?: unknown; message?: string };
    reportWorkerError(detail.error ?? detail.message ?? "Unknown worker error", {
      handler: "global",
    });
  });

  scope.addEventListener("unhandledrejection", (event) => {
    const detail = event as { reason?: unknown };
    reportWorkerError(detail.reason ?? "Unhandled rejection", { handler: "unhandledrejection" });
  });
}

/** Test seam: forget the installed options and the per-instance counters. */
export function resetWorkerReporterForTests(): void {
  options = null;
  config = undefined;
  sent = 0;
}
