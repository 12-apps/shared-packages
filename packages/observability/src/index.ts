/**
 * Browser error reporting for the three SPAs (FUT-717).
 *
 * ## The principle, inherited from the server
 *
 * FUT-716 did not hang `captureException` beside every `throw`. It hung the
 * transport off the shared LOGGER, and said why: *"the alternative is a rule
 * that decays the first time someone forgets it."*
 *
 * The browser's equivalent funnels already exist, and this module attaches to
 * all three rather than asking any page to remember anything:
 *
 *   1. `RouteErrorBoundary` — already catches every page crash in all three SPAs.
 *   2. `window.onerror` — whatever escapes React.
 *   3. `unhandledrejection` — a rejected promise nobody caught, which is how a
 *      failed `apiFetch` arrives when no caller handles it.
 *
 * ## It is OFF unless the backend hands over a DSN
 *
 * No DSN, no SDK, no network. Dev, CI and every test run stay offline, which is
 * also what stops a suite filling the issue tracker with its own deliberate
 * failures. Same contract as the server's `sentryEnabled()`.
 *
 * ## The one cost of serving the DSN, and how it is paid
 *
 * Because the config arrives over the network, the SDK starts a round-trip
 * late, and an error thrown in that window would be lost. So the global
 * handlers are installed SYNCHRONOUSLY, before the first render, and buffer
 * into memory; the buffer is drained into the SDK once it is up, or discarded
 * if reporting turns out to be off. The only window left uncovered is "the
 * browser could not fetch the entry bundle at all", which no in-page reporter
 * catches anyway.
 */
import * as Sentry from "@sentry/react";
import { useEffect } from "react";

import { DEFAULT_CONFIG_ENDPOINT, loadObservabilityConfig, type ObservabilityApp } from "./config";
import { shouldReport, SOURCE_ROUTE_BOUNDARY, SOURCE_TAG } from "./noise";
import { scrub, scrubUrl } from "./scrub";

export type { ObservabilityApp } from "./config";
export { DEFAULT_CONFIG_ENDPOINT } from "./config";
export {
  setErrorClassifiers,
  resetErrorClassifiersForTests,
  type ErrorClassifiers,
} from "./noise";
export { scrub, scrubUrl } from "./scrub";
export { SOURCE_ROUTE_BOUNDARY, SOURCE_TAG } from "./noise";

/** One buffered pre-init failure. */
interface Pending {
  error: unknown;
  source?: string;
}

/**
 * Cap on the pre-init buffer.
 *
 * A page that throws in a render loop can produce thousands of errors in the
 * time one fetch takes. Keeping the first few is enough to explain the failure;
 * keeping all of them is an unbounded array on a page that is already sick.
 */
const MAX_BUFFERED = 20;

let pending: Pending[] = [];
let started = false;
let listening = false;

function buffer(error: unknown): void {
  if (pending.length < MAX_BUFFERED) pending.push({ error });
}

function onWindowError(event: ErrorEvent): void {
  buffer(event.error ?? event.message);
}

function onRejection(event: PromiseRejectionEvent): void {
  buffer(event.reason);
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onRejection);
  listening = true;
}

function stopListening(): void {
  if (!listening) return;
  window.removeEventListener("error", onWindowError);
  window.removeEventListener("unhandledrejection", onRejection);
  listening = false;
}

/** Best-effort text for the noise filter to match against. */
function describe(event: Sentry.ErrorEvent, error: unknown): string {
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
function beforeSend(
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): Sentry.ErrorEvent | null {
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

  return scrub(event) as Sentry.ErrorEvent;
}

/**
 * Install reporting for this app.
 *
 * Call it FIRST in `main.tsx`, before `createRoot`. Returns a promise for the
 * tests' benefit; production callers deliberately ignore it, since nothing
 * should wait on reporting to render.
 */
export async function startObservability(
  app: ObservabilityApp,
  { endpoint = DEFAULT_CONFIG_ENDPOINT }: { endpoint?: string } = {},
): Promise<void> {
  if (started) return;
  started = true;

  // Synchronous, so an error thrown while the config is still in flight is
  // still caught. Everything after this point is allowed to be late.
  listen();

  const config = await loadObservabilityConfig(app, endpoint);

  // No DSN is the normal state in dev, CI and any deployment that has not
  // opted in. Drop the buffer and stop listening: holding a growing array of
  // errors nobody will ever send is the only way this could hurt.
  if (!config || config.dsn === "") {
    pending = [];
    stopListening();
    return;
  }

  // Ordered so nothing can slip between: the SDK installs its OWN global
  // handlers, so ours come off first to avoid reporting each error twice.
  stopListening();

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    // Must equal the release the source maps were uploaded under (FUT-723) or
    // Sentry holds both artifacts and associates neither.
    release: config.release === "" ? undefined : config.release,
    // The SDK's own PII switch, held OFF regardless of DSN. It is what decides
    // whether request bodies, cookies and IP addresses ride along.
    sendDefaultPii: false,
    // Tracing is billed per span and answers "how slow"; this exists to answer
    // "what threw". Opt in deliberately, per deployment, if ever.
    tracesSampleRate: 0,
    // NOTE: Session Replay is deliberately not enabled. The storefront's
    // crashes happen ON the checkout form, and a replay of that screen is a
    // recording of someone's card and CPF. Turning it on is a separate,
    // explicit decision that needs masking configured first.
    beforeSend,
  });

  const drained = pending;
  pending = [];
  for (const item of drained) {
    Sentry.captureException(item.error);
  }
}

/**
 * Attach who this is, WITHOUT identifying them.
 *
 * The tenant is what separates "this page is broken" from "this page is broken
 * for one store's data", which is the difference between fixing code and fixing
 * a row. The e-mail and name on `SessionUser` are exactly the fields that must
 * not travel, so this takes a narrow object rather than a session.
 */
export interface ObservabilityContext {
  /** Store slug the caller is administering. */
  tenant?: string | null;
  /** The caller's role on that store — `OWNER`, `WAITER`, … */
  role?: string | null;
  /** True while acting as somebody else (super-admin). */
  impersonating?: boolean;
  /**
   * The store being WORN during an impersonation.
   *
   * A separate key from `tenant` on purpose. Two independent components set
   * this context — an app's layout knows the tenant, the shared impersonation
   * banner knows the impersonation — and if both wrote `tenant` the later
   * effect would silently overwrite the earlier one, in an order neither
   * controls.
   */
  impersonatedStore?: string | null;
}

export function setObservabilityContext(context: ObservabilityContext): void {
  if (!Sentry.getClient()) return;
  // Only keys the caller actually passed are written. `undefined` means "I
  // don't know about this one", which must not erase what another component
  // already set; `null` is the explicit "none".
  if (context.tenant !== undefined) Sentry.setTag("tenant", context.tenant ?? "none");
  if (context.role !== undefined) Sentry.setTag("role", context.role ?? "anonymous");
  if (context.impersonating !== undefined) {
    Sentry.setTag("impersonating", String(context.impersonating));
  }
  if (context.impersonatedStore !== undefined) {
    Sentry.setTag("impersonated_store", context.impersonatedStore ?? "none");
  }
}

/**
 * The hook form, for a shell that learns who is signed in only after a query
 * resolves. Safe to call with `undefined` on the first renders — which is what
 * lets it sit ABOVE a layout's early returns, where the rules of hooks require
 * it to be.
 */
export function useObservabilityContext(context: ObservabilityContext): void {
  const { tenant, role, impersonating, impersonatedStore } = context;
  useEffect(() => {
    setObservabilityContext({ tenant, role, impersonating, impersonatedStore });
  }, [tenant, role, impersonating, impersonatedStore]);
}

/**
 * Report a crash caught by `RouteErrorBoundary`.
 *
 * Tagged as boundary-sourced because that is what tells the noise filter a
 * chunk-load failure here is REAL: `loadRouteChunk` swallows the first one and
 * reloads, so anything arriving at the boundary has already survived that
 * recovery. See `noise.ts`.
 */
export function reportRouteCrash(error: unknown, componentStack?: string | null): void {
  if (!Sentry.getClient()) return;
  Sentry.withScope((scope) => {
    scope.setTag(SOURCE_TAG, SOURCE_ROUTE_BOUNDARY);
    // The stack alone does not carry the component trace, and the component
    // trace is usually what names the page.
    if (componentStack) scope.setContext("react", { componentStack });
    Sentry.captureException(error);
  });
}

/**
 * Report something that went wrong but did not throw.
 *
 * The case this exists for is the one a `console.warn` used to cover: an
 * operation that FAILED, was handled, and left the user on a working screen —
 * so nothing crashes, nothing is caught by a boundary, and the only record was
 * a line in a console nobody reads. A buyer's contact details failing to save
 * during checkout is exactly that shape.
 *
 * `warning` level rather than `error`: it is real, but it is not a crash, and
 * conflating the two makes the error list useless for triage.
 *
 * A no-op until a DSN is configured, like everything else here.
 */
export function reportWarning(message: string, context?: Record<string, unknown>): void {
  if (!Sentry.getClient()) return;
  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    // Scrubbed and folded in as data rather than interpolated: the caller's
    // context can carry an id worth keeping next to a field that is not.
    if (context) scope.setContext("detail", scrub(context) as Record<string, unknown>);
    Sentry.captureMessage(message);
  });
}

/** Test seam: forget that `startObservability` ran. */
export function resetObservabilityForTests(): void {
  stopListening();
  pending = [];
  started = false;
}
