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
 *
 * ## The SDK itself arrives after `load`
 *
 * Only the handlers and the buffer are eager. The SDK is fetched with a dynamic
 * `import()` of `./sdk` once the page has loaded, so its bytes (about 28 KB
 * brotli on the storefront) stop sharing a slow link with the entry chunk and
 * the first screen's data. `./sdk` names what is called, which is what keeps
 * the lazy chunk shaken (see there). That
 * was never what FUT-717 asked of the boot path: what must precede the first
 * render is the LISTENING, which is this module's own few lines.
 *
 * Until the SDK is up everything queues into the same bounded buffer: a global
 * error, a route crash, a warning. The context a shell sets is merged and
 * applied at init. What is lost against an eager SDK is the SDK's own
 * breadcrumbs from before `load`, and a report from a tab closed before `load`.
 */
import type * as SentryApi from "@sentry/react";
import { useEffect } from "react";

import { beforeSend } from "./before-send";

import { DEFAULT_CONFIG_ENDPOINT, loadObservabilityConfig, type ObservabilityApp } from "./config";
import { SOURCE_ROUTE_BOUNDARY, SOURCE_TAG } from "./noise";
import { scrub } from "./scrub";
import type { Sdk } from "./sdk";

export type { ObservabilityApp } from "./config";
export { DEFAULT_CONFIG_ENDPOINT } from "./config";
export {
  setErrorClassifiers,
  resetErrorClassifiersForTests,
  type ErrorClassifiers,
} from "./noise";
export { scrub, scrubUrl } from "./scrub";
export { setSpanTextScrubber, resetSpanTextScrubberForTests, type SpanTextScrubber } from "./span-rule";
export { SOURCE_ROUTE_BOUNDARY, SOURCE_TAG } from "./noise";

/** One report held until the SDK is up. */
type Pending =
  | { kind: "error"; error: unknown }
  | { kind: "crash"; error: unknown; componentStack?: string | null }
  | { kind: "warning"; message: string; context?: Record<string, unknown> };

/**
 * Cap on the pre-init buffer.
 *
 * A page that throws in a render loop can produce thousands of errors in the
 * time one fetch takes. Keeping the first few is enough to explain the failure;
 * keeping all of them is an unbounded array on a page that is already sick.
 */
const MAX_BUFFERED = 20;

/**
 * `idle` before `startObservability`, `waiting` while the config and the SDK
 * are in flight, then `on` or `off` for good.
 */
let phase: "idle" | "waiting" | "on" | "off" = "idle";
let sdk: Sdk | null = null;
let pending: Pending[] = [];
let context: ObservabilityContext = {};
let listening = false;

function hold(item: Pending): void {
  if (pending.length < MAX_BUFFERED) pending.push(item);
}

function buffer(error: unknown): void {
  hold({ kind: "error", error });
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
  if (phase !== "idle") return;
  phase = "waiting";

  // Synchronous, so an error thrown while the config is still in flight is
  // still caught. Everything after this point is allowed to be late.
  listen();

  const config = await loadObservabilityConfig(app, endpoint);

  // No DSN is the normal state in dev, CI and any deployment that has not
  // opted in. Drop the buffer and stop listening: holding a growing array of
  // errors nobody will ever send is the only way this could hurt. The SDK is
  // never fetched.
  if (!config || config.dsn === "") return switchOff();

  // A chunk that fails to load (a deploy replaced it) costs reporting for this
  // tab and nothing else.
  const loaded = await whenLoaded().then(loadSdk, () => null);
  if (loaded === null) return switchOff();

  // Ordered so nothing can slip between: the SDK installs its OWN global
  // handlers, so ours come off first to avoid reporting each error twice.
  stopListening();

  loaded.init({
    dsn: config.dsn,
    environment: config.environment,
    // Must equal the release the source maps were uploaded under (FUT-723) or
    // Sentry holds both artifacts and associates neither.
    release: config.release === "" ? undefined : config.release,
    // The SDK's own PII switch, held OFF regardless of DSN. It is what decides
    // whether request bodies, cookies and IP addresses ride along.
    sendDefaultPii: false,
    // Tracing is billed per span and answers "how slow"; errors answer "what
    // threw". The host opts in per app and per deployment through the served
    // config (FUT-2951); absent, it is 0 and nothing but errors is sent.
    ...performanceOptions(config.tracesSampleRate),
    // NOTE: Session Replay is deliberately not enabled. The storefront's
    // crashes happen ON the checkout form, and a replay of that screen is a
    // recording of someone's card and CPF. Turning it on is a separate,
    // explicit decision that needs masking configured first.
    beforeSend,
  });
  sdk = loaded;
  phase = "on";

  applyContext(loaded, context);
  const drained = pending;
  pending = [];
  for (const item of drained) send(loaded, item);

  if (config.tracesSampleRate > 0) loadWebVitals();
}

function switchOff(): void {
  phase = "off";
  pending = [];
  stopListening();
}

/** Resolves once the page has loaded, and never before the first paint. */
function whenLoaded(): Promise<void> {
  return new Promise((resolve) => afterLoad(resolve));
}

function loadSdk(): Promise<Sdk | null> {
  return import("./sdk").then(
    (module) => module.sdk,
    () => null,
  );
}

function send(client: Sdk, item: Pending): void {
  if (item.kind === "error") client.captureException(item.error);
  if (item.kind === "crash") sendRouteCrash(client, item.error, item.componentStack);
  if (item.kind === "warning") sendWarning(client, item.message, item.context);
}

/** The SDK once it is up and initialised, else null. */
function liveSdk(): Sdk | null {
  return sdk?.getClient() ? sdk : null;
}

/**
 * The client options for a performance rate. At 0 the SDK is exactly what it
 * was before FUT-2951: no tracing, no span hook. Above 0, spans are STREAMED
 * — a client-wide setting, so every span leaves through `beforeSendSpan` and
 * that one hook scrubs them all. The hook itself is installed by
 * `installWebVitals`, with the only integrations that make spans, so the scrub
 * loads after `load` too (see web-vitals.ts).
 */
function performanceOptions(rate: number): Partial<SentryApi.BrowserOptions> {
  if (rate <= 0) return { tracesSampleRate: 0 };
  return {
    tracesSampleRate: rate,
    traceLifecycle: "stream",
  };
}

/** Run `task` once the page has loaded, and never before the first paint. */
function afterLoad(task: () => void): void {
  if (typeof window === "undefined") return;
  if (document.readyState === "complete") {
    task();
    return;
  }
  window.addEventListener("load", task, { once: true });
}

/** Fetch and install the Web Vitals integrations; a failure costs only the vitals. */
function loadWebVitals(): void {
  import("./web-vitals").then(
    ({ installWebVitals }) => installWebVitals(),
    () => undefined,
  );
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

export function setObservabilityContext(next: ObservabilityContext): void {
  // Only keys the caller actually passed are written. `undefined` means "I
  // don't know about this one", which must not erase what another component
  // already set; `null` is the explicit "none". Kept while the SDK is on its
  // way, so a shell that knows the tenant before `load` still tags the report.
  const known = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
  context = { ...context, ...known };
  const live = liveSdk();
  if (live) applyContext(live, known);
}

function applyContext(client: Sdk, values: ObservabilityContext): void {
  if (values.tenant !== undefined) client.setTag("tenant", values.tenant ?? "none");
  if (values.role !== undefined) client.setTag("role", values.role ?? "anonymous");
  if (values.impersonating !== undefined) {
    client.setTag("impersonating", String(values.impersonating));
  }
  if (values.impersonatedStore !== undefined) {
    client.setTag("impersonated_store", values.impersonatedStore ?? "none");
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
  const live = liveSdk();
  if (live) sendRouteCrash(live, error, componentStack);
  else if (phase === "waiting") hold({ kind: "crash", error, componentStack });
}

function sendRouteCrash(client: Sdk, error: unknown, componentStack?: string | null): void {
  client.withScope((scope) => {
    scope.setTag(SOURCE_TAG, SOURCE_ROUTE_BOUNDARY);
    // The stack alone does not carry the component trace, and the component
    // trace is usually what names the page.
    if (componentStack) scope.setContext("react", { componentStack });
    client.captureException(error);
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
export function reportWarning(message: string, detail?: Record<string, unknown>): void {
  const live = liveSdk();
  if (live) sendWarning(live, message, detail);
  else if (phase === "waiting") hold({ kind: "warning", message, context: detail });
}

function sendWarning(client: Sdk, message: string, detail?: Record<string, unknown>): void {
  client.withScope((scope) => {
    scope.setLevel("warning");
    // Scrubbed and folded in as data rather than interpolated: the caller's
    // context can carry an id worth keeping next to a field that is not.
    if (detail) scope.setContext("detail", scrub(detail) as Record<string, unknown>);
    client.captureMessage(message);
  });
}

/** Test seam: forget that `startObservability` ran. */
export function resetObservabilityForTests(): void {
  stopListening();
  phase = "idle";
  sdk = null;
  pending = [];
  context = {};
}

/**
 * Test seam: report through `module` as if `startObservability` had loaded it,
 * for a suite that drives a mocked client directly.
 */
export function adoptSdkForTests(module: unknown): void {
  sdk = module as Sdk;
}
