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

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  getClient: vi.fn(() => undefined as unknown),
  setTag: vi.fn(),
  withScope: vi.fn(),
}));

vi.mock("@sentry/react", () => sentry);

import { loadObservabilityConfig } from "../config";
import { resetObservabilityForTests, startObservability } from "../index";

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
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  sentry.getClient.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetObservabilityForTests();
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
