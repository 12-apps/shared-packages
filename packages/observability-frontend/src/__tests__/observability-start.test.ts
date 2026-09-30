/**
 * The wiring (FUT-719): config handoff, the OFF-by-default contract, and the
 * pre-init buffer.
 *
 * The load-bearing case is `does not initialise without a DSN`. Every dev
 * machine, every CI run and every PR build is in that state, so if it ever
 * regresses the whole suite starts opening connections to a third party and
 * filing the failures it raises on purpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() }));

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  getClient: vi.fn(() => undefined as unknown),
  setTag: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback: (current: unknown) => void) => callback(scope)),
  withStreamedSpan: vi.fn((callback: unknown) => callback),
  addIntegration: vi.fn(),
  spanStreamingIntegration: vi.fn(() => ({ name: "SpanStreaming" })),
  browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
}));

vi.mock("@sentry/react", () => sentry);

import { loadObservabilityConfig } from "../config";
import { SOURCE_ROUTE_BOUNDARY, SOURCE_TAG } from "../noise";
import {
  reportRouteCrash,
  reportWarning,
  resetObservabilityForTests,
  setObservabilityContext,
  setQuietWindowForTests,
  startObservability,
} from "../index";

/**
 * Install a fetch stub for THIS test and hand back the URLs it saw.
 *
 * Returned as a local rather than kept in a module-scope container so no case
 * can inherit the previous one's canned reply — which is exactly how "reports
 * nothing without a DSN" would go green while being wrong. The stub pushes into
 * a captured array (a container mutation) rather than reassigning a captured
 * binding, which the flakiness gate requires of anything a stub closes over.
 */
function serveConfig(responder: () => Promise<Response>): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    calls.push(String(url));
    return responder();
  });
  return { calls };
}

function jsonReply(data: unknown, status = 200): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ data }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

/** The default every case starts from: reachable backend, reporting switched off. */
const NO_DSN = jsonReply({ dsn: "", environment: "test", release: "" });

beforeEach(() => {
  serveConfig(NO_DSN);
  resetObservabilityForTests();
  // No wait for quiet unless a case asks for one: the cases below it are about
  // what happens once the SDK is fetched, not when.
  setQuietWindowForTests({ quietMs: 0, capMs: 0 });
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  sentry.setTag.mockClear();
  scope.setTag.mockClear();
  sentry.addIntegration.mockReset();
  sentry.getClient.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetObservabilityForTests();
  setQuietWindowForTests(null);
});

describe("loadObservabilityConfig", () => {
  it("asks the backend for this app's project", async () => {
    const net = serveConfig(jsonReply({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "prd", release: "abc" }));
    const config = await loadObservabilityConfig("storefront");

    expect(net.calls[0]).toContain("/api/observability-config?app=storefront");
    expect(config?.dsn).toBe("https://k@o1.ingest.sentry.io/1");
  });

  it("resolves null rather than throwing when the endpoint is missing", async () => {
    // An older backend answers 404. Reporting must decline, not explode — this
    // runs on the boot path of every page.
    serveConfig(() => Promise.resolve(new Response("nope", { status: 404 })));
    await expect(loadObservabilityConfig("admin")).resolves.toBeNull();
  });

  it("resolves null when offline", async () => {
    serveConfig(() => Promise.reject(new Error("network down")));
    await expect(loadObservabilityConfig("admin")).resolves.toBeNull();
  });

  it("resolves null on a malformed body rather than half-configuring", async () => {
    serveConfig(jsonReply({ dsn: 42 }));
    await expect(loadObservabilityConfig("super-admin")).resolves.toBeNull();
  });

  it("reads an ABSENT performance rate as 0 — an older backend must not switch errors off", async () => {
    serveConfig(jsonReply({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "prd", release: "" }));
    const config = await loadObservabilityConfig("storefront");
    expect(config).not.toBeNull();
    expect(config?.tracesSampleRate).toBe(0);
  });

  it("carries a served performance rate through", async () => {
    serveConfig(
      jsonReply({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "prd", release: "", tracesSampleRate: 1 }),
    );
    await expect(loadObservabilityConfig("storefront")).resolves.toMatchObject({ tracesSampleRate: 1 });
  });

  it.each([["1"], [2], [-0.5], [Number.NaN], [null]])(
    "rejects a PRESENT but malformed performance rate (%s)",
    async (tracesSampleRate) => {
      serveConfig(jsonReply({ dsn: "https://k@o1.ingest.sentry.io/1", environment: "prd", release: "", tracesSampleRate }));
      await expect(loadObservabilityConfig("storefront")).resolves.toBeNull();
    },
  );
});

describe("startObservability", () => {
  it("does NOT initialise the SDK when the DSN is empty", async () => {
    // The contract that keeps dev, CI and every PR build offline.
    await startObservability("storefront");
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("does NOT initialise when the config cannot be fetched", async () => {
    serveConfig(() => Promise.reject(new Error("offline")));
    await startObservability("storefront");
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initialises with the served DSN, release and environment", async () => {
    serveConfig(
      jsonReply({
        dsn: "https://k@o1.ingest.sentry.io/7",
        environment: "production",
        release: "c11163c",
      }),
    );

    await startObservability("admin");

    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.dsn).toBe("https://k@o1.ingest.sentry.io/7");
    expect(options.environment).toBe("production");
    expect(options.release).toBe("c11163c");
  });

  it("holds the SDK's own PII switch off, and buys no tracing", async () => {
    serveConfig(
      jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "" }),
    );
    await startObservability("storefront");

    const options = sentry.init.mock.calls[0]?.[0] as Record<string, unknown>;
    // Decides whether request bodies, cookies and IPs ride along.
    expect(options.sendDefaultPii).toBe(false);
    // Tracing is billed per span and answers a different question.
    expect(options.tracesSampleRate).toBe(0);
    // Replay would record the checkout form. Enabling it is a separate decision.
    expect(options.integrations).toBeUndefined();
  });

  it("streams performance spans, through the scrubbing hook, when a rate is served", async () => {
    const installOrder: string[] = [];
    const clientOptions: Record<string, unknown> = {};
    // A live options object, as Sentry's client returns: the hook is written
    // onto it, and the order it lands in against the integrations is recorded.
    const tracked = new Proxy(clientOptions, {
      set(target, key, value) {
        installOrder.push(String(key));
        return Reflect.set(target, key, value);
      },
    });
    sentry.getClient.mockReturnValue({ getOptions: () => tracked });
    sentry.addIntegration.mockImplementation((integration: { name: string }) => {
      installOrder.push(integration.name);
    });
    serveConfig(
      jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "", tracesSampleRate: 1 }),
    );
    await startObservability("storefront");

    const options = sentry.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.tracesSampleRate).toBe(1);
    // Client-wide: every span then leaves through beforeSendSpan, never through
    // beforeSendTransaction, which is why the scrub lives on that one hook.
    expect(options.traceLifecycle).toBe("stream");
    // Not at init: the hook ships with the vitals chunk, off the critical path.
    expect(options.beforeSendSpan).toBeUndefined();
    // After load (jsdom's document is already complete), both integrations the
    // vitals need arrive: the recorder AND the one that sends a streamed span.
    await vi.waitFor(() => expect(sentry.addIntegration).toHaveBeenCalledTimes(2));
    expect(sentry.addIntegration).toHaveBeenCalledWith({ name: "SpanStreaming" });
    // Browser tracing, not the vitals integration alone: LCP and CLS report
    // against the pageload span, which only browser tracing starts. It adds
    // the vitals integration itself.
    expect(sentry.addIntegration).toHaveBeenCalledWith({ name: "BrowserTracing" });
    // At a rate of 1 every span is billed, so everything that is not a vital
    // or its pageload is off — requests (and their propagation headers),
    // resources, long tasks, marks and measures, route changes.
    expect(sentry.browserTracingIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        traceFetch: false,
        traceXHR: false,
        instrumentNavigation: false,
        enableLongTask: false,
        enableLongAnimationFrame: false,
        ignoreResourceSpans: expect.arrayContaining(["resource.script", "resource.css", "resource.img"]),
      }),
    );
    // ...and the scrub is on the live client options BEFORE either of them, so
    // no span can leave unscrubbed.
    expect(typeof clientOptions.beforeSendSpan).toBe("function");
    expect(sentry.withStreamedSpan).toHaveBeenCalled();
    expect(installOrder).toEqual(["beforeSendSpan", "SpanStreaming", "BrowserTracing"]);
  });

  it("installs no performance integration when no rate is served", async () => {
    serveConfig(jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "" }));
    await startObservability("storefront");
    // Settles any `import("./web-vitals")` that WAS started, rather than
    // waiting a fixed delay and hoping it was long enough.
    await vi.dynamicImportSettled();
    expect(sentry.addIntegration).not.toHaveBeenCalled();
  });

  it("reports an error thrown BEFORE the config arrived", async () => {
    // The one cost of serving the DSN instead of baking it. The global
    // handlers are installed synchronously and buffer; the buffer is drained
    // once the SDK is up.
    serveConfig(
      jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "" }),
    );

    const booting = startObservability("storefront");
    const early = new Error("threw during boot");
    window.dispatchEvent(new ErrorEvent("error", { error: early, message: early.message }));
    await booting;

    expect(sentry.captureException).toHaveBeenCalledWith(early);
  });

  it("discards the buffer when reporting turns out to be off", async () => {
    const booting = startObservability("storefront");
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("boom"), message: "boom" }),
    );
    await booting;

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("is idempotent", async () => {
    serveConfig(
      jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "" }),
    );
    await startObservability("storefront");
    await startObservability("storefront");
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });
});

/**
 * Hold the document in `loading` until the returned function fires `load`.
 *
 * jsdom's document is already complete, which is what every case above runs
 * in; these need the window before it.
 */
function holdPageLoad(): () => void {
  Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
  return () => {
    Reflect.deleteProperty(document, "readyState");
    window.dispatchEvent(new Event("load"));
  };
}

/** The SDK answers `getClient()` once `init` has run, as the real one does. */
function clientAfterInit(): void {
  sentry.init.mockImplementationOnce(() => {
    sentry.getClient.mockReturnValue({ getOptions: () => ({}) });
  });
}

const WITH_DSN = jsonReply({ dsn: "https://k@o1.ingest.sentry.io/7", environment: "prd", release: "" });

describe("the SDK arrives after load", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "readyState");
  });

  it("does not initialise the SDK before the page has loaded", async () => {
    // The point of the lazy SDK: its bytes must not share the link with the
    // entry chunk and the first screen's data. The config may arrive first.
    serveConfig(WITH_DSN);
    const fireLoad = holdPageLoad();
    const listeners = vi.spyOn(window, "addEventListener");
    const booting = startObservability("storefront");
    // The config has been read and the SDK is now waiting on `load`.
    await vi.waitFor(() =>
      expect(listeners).toHaveBeenCalledWith("load", expect.any(Function), { once: true }),
    );
    listeners.mockRestore();
    expect(sentry.init).not.toHaveBeenCalled();

    fireLoad();
    await booting;
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("sends a route crash and a warning reported before the SDK was up", async () => {
    serveConfig(WITH_DSN);
    clientAfterInit();
    const fireLoad = holdPageLoad();
    const booting = startObservability("storefront");

    const crash = new Error("page crashed during boot");
    reportRouteCrash(crash, "at Menu");
    reportWarning("contact not saved", { orderId: "o1" });
    expect(sentry.captureException).not.toHaveBeenCalled();

    fireLoad();
    await booting;
    expect(sentry.captureException).toHaveBeenCalledWith(crash);
    // Still marked as the boundary's, which is what the noise filter reads.
    expect(scope.setTag).toHaveBeenCalledWith(SOURCE_TAG, SOURCE_ROUTE_BOUNDARY);
    expect(sentry.captureMessage).toHaveBeenCalledWith("contact not saved");
  });

  it("drops what it queued when reporting turns out to be off", async () => {
    const booting = startObservability("storefront");
    reportRouteCrash(new Error("boom"));
    reportWarning("lost");
    await booting;
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("reports nothing that arrives after reporting was switched off", async () => {
    await startObservability("storefront");
    reportRouteCrash(new Error("late"));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("tags the report with the context a shell set before the SDK was up", async () => {
    serveConfig(WITH_DSN);
    clientAfterInit();
    const fireLoad = holdPageLoad();
    const booting = startObservability("storefront");

    setObservabilityContext({ tenant: "aliment-sabor", role: null });
    // A second component that knows nothing about the tenant must not erase it.
    setObservabilityContext({ tenant: undefined, impersonating: false });

    fireLoad();
    await booting;
    expect(sentry.setTag).toHaveBeenCalledWith("tenant", "aliment-sabor");
    expect(sentry.setTag).toHaveBeenCalledWith("role", "anonymous");
    expect(sentry.setTag).toHaveBeenCalledWith("impersonating", "false");
    expect(sentry.setTag).not.toHaveBeenCalledWith("tenant", "none");
  });
});

/**
 * Stand in for the browser's resource timing: `finish()` reports that a
 * download completed, to every observer the code under test created.
 */
function fakeResourceTiming(): { observers: Array<() => void>; finish: () => void } {
  const observers: Array<() => void> = [];
  class FakeObserver {
    static supportedEntryTypes = ["resource"];
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  return { observers, finish: () => observers.forEach((callback) => callback()) };
}

describe("the SDK waits for the page to finish downloading", () => {
  it("until no resource has finished for the quiet window", async () => {
    // `load` alone is too early in an SPA: the route and the first screen's
    // data are fetched after it, and the SDK would share the link with them.
    setQuietWindowForTests({ quietMs: 3000, capMs: 20_000 });
    const timing = fakeResourceTiming();
    serveConfig(WITH_DSN);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const booting = startObservability("storefront");
    await vi.waitFor(() => expect(timing.observers).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(2000);
    timing.finish();
    await vi.advanceTimersByTimeAsync(2500);
    // 4.5 s after load, but only 2.5 s after the last download.
    expect(sentry.init).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    await booting;
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("but never past the cap, however busy the page stays", async () => {
    setQuietWindowForTests({ quietMs: 3000, capMs: 20_000 });
    const timing = fakeResourceTiming();
    serveConfig(WITH_DSN);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const booting = startObservability("storefront");
    await vi.waitFor(() => expect(timing.observers).toHaveLength(1));

    for (let second = 1; second <= 19; second += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      timing.finish();
    }
    expect(sentry.init).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1100);
    await booting;
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("except for a crash, which fetches it at once", async () => {
    // The report worth most, from the tab most likely to be closed first.
    setQuietWindowForTests({ quietMs: 60_000, capMs: 60_000 });
    serveConfig(WITH_DSN);
    clientAfterInit();
    const booting = startObservability("storefront");
    const crash = new Error("menu crashed");
    reportRouteCrash(crash);

    await booting;
    expect(sentry.captureException).toHaveBeenCalledWith(crash);
  });

  it("while noise does not hurry it, and a warning does", async () => {
    setQuietWindowForTests({ quietMs: 60_000, capMs: 60_000 });
    const timing = fakeResourceTiming();
    serveConfig(WITH_DSN);
    const booting = startObservability("storefront");
    await vi.waitFor(() => expect(timing.observers).toHaveLength(1));

    // An extension's error: the filter drops it, so it buys no early SDK.
    const foreign = new Error("boom");
    foreign.stack = "Error: boom\n    at chrome-extension://abcdef/content.js:1:1";
    window.dispatchEvent(new ErrorEvent("error", { error: foreign, message: foreign.message }));
    await vi.dynamicImportSettled();
    expect(sentry.init).not.toHaveBeenCalled();

    reportWarning("contact not saved");
    await booting;
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });
});
