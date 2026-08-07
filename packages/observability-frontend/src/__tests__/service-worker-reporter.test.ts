/**
 * The worker reporter — the half of browser reporting no page can see.
 *
 * The cases are weighted towards NOT sending, for the same reason the rest of
 * this package is: a worker runs on every request of every visit, so a reporter
 * that is merely enthusiastic is a bill and a haystack. Offline is a worker's
 * normal weather, not a defect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installWorkerReporter,
  reportWorkerError,
  resetWorkerReporterForTests,
} from "../service-worker/index";

const DSN = "https://abc123def@o42.ingest.sentry.io/4507";

/** Answers the config endpoint, and records every envelope POST. */
function stubFetch(config: unknown = { data: { dsn: DSN, environment: "production", release: "r1" } }) {
  const posts: { url: string; body: string }[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: init.body ?? "" });
      return { ok: true } as unknown as Response;
    }
    return { ok: config !== null, json: async () => config } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, fetchMock };
}

/** The envelope is three newline-delimited JSON lines; the event is the third. */
function eventFrom(body: string): Record<string, unknown> {
  return JSON.parse(body.split("\n")[2] as string) as Record<string, unknown>;
}

/**
 * Drain the microtask queue.
 *
 * `reportWorkerError` returns void on purpose — a caller inside a worker must
 * never be made to await its own error reporting — so there is no promise to
 * await at the call site. Nothing here sleeps: every assertion below either
 * waits for an observable signal, or runs after the queue is empty.
 */
async function flush(): Promise<void> {
  // Six turns of the microtask queue — deeper than the reporter's await chain.
  await Promise.resolve().then().then().then().then().then();
}

beforeEach(() => {
  resetWorkerReporterForTests();
  vi.stubGlobal("crypto", { randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWorkerReporterForTests();
});

describe("the worker reporter stays quiet when it should", () => {
  it("sends nothing before it is installed", async () => {
    const { posts } = stubFetch();
    reportWorkerError(new Error("too early"));
    await flush();
    expect(posts).toHaveLength(0);
  });

  it("drops a failed request — offline is a worker's normal weather", async () => {
    const { posts, fetchMock } = stubFetch();
    installWorkerReporter({ app: "storefront" });
    // Every browser words it differently, and all three mean the same thing.
    reportWorkerError(new TypeError("Load failed"));
    reportWorkerError(new TypeError("Failed to fetch"));
    reportWorkerError(new TypeError("NetworkError when attempting to fetch resource."));
    await flush();
    // Rejected before any I/O: not even the config was asked for.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it("sends nothing when the backend hands over no DSN", async () => {
    const { posts, fetchMock } = stubFetch(null);
    installWorkerReporter({ app: "storefront" });
    reportWorkerError(new Error("boom"));
    // The config request IS made — it is the answer that turns reporting off.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await flush();
    expect(posts).toHaveLength(0);
  });

  it("stops at the per-instance cap", async () => {
    const { posts } = stubFetch();
    installWorkerReporter({ app: "storefront", maxEvents: 2 });
    Array.from({ length: 5 }, (_, index) => reportWorkerError(new Error(`boom ${index}`)));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    // …and STAYS at two. All five ran synchronously up to the first await, so a
    // counter incremented after the send would have let every one of them past.
    await flush();
    expect(posts).toHaveLength(2);
  });

  it("never throws at the call site, whatever the transport does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("transport is down");
      }),
    );
    installWorkerReporter({ app: "storefront" });
    // The point: a reporter that can fail its caller turns a logged problem
    // into a broken fetch handler, which in a worker means a broken page.
    expect(() => reportWorkerError(new Error("boom"))).not.toThrow();
    await flush();
  });
});

describe("the envelope it does send", () => {
  it("goes to the DSN's envelope endpoint with the public key", async () => {
    const { posts } = stubFetch();
    installWorkerReporter({ app: "storefront" });
    reportWorkerError(new Error("cache write failed"), { handler: "install" });
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    expect(posts[0]?.url).toBe(
      "https://o42.ingest.sentry.io/api/4507/envelope/?sentry_key=abc123def&sentry_version=7",
    );
  });

  it("carries the error, the release, and a tag that separates it from page errors", async () => {
    const { posts } = stubFetch();
    installWorkerReporter({ app: "storefront" });
    reportWorkerError(new Error("cache write failed"), { handler: "install" });
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    const event = eventFrom(posts[0]?.body ?? "");
    expect(event.release).toBe("r1");
    expect(event.environment).toBe("production");
    // A worker failure and a render crash want different people looking.
    expect(event.tags).toMatchObject({ source: "service-worker", handler: "install" });
    const exception = event.exception as { values: { type: string; value: string }[] };
    expect(exception.values[0]).toMatchObject({ type: "Error", value: "cache write failed" });
  });

  it("strips the query string off a URL and redacts PII in extra", async () => {
    const { posts } = stubFetch();
    installWorkerReporter({ app: "storefront" });
    reportWorkerError(new Error("boom"), {
      // A query string is where a token or a `?next=` e-mail ends up.
      url: "https://loja.example.com/menu?token=secret&next=alguem@example.com",
      extra: { email: "alguem@example.com", orderId: "abc123" },
    });
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    const extra = eventFrom(posts[0]?.body ?? "").extra as Record<string, unknown>;
    expect(extra.url).toBe("https://loja.example.com/menu");
    expect(extra.email).toBe("[redacted]");
    // Ids survive on purpose: a scrub that eats them leaves the event useless.
    expect(extra.orderId).toBe("abc123");
  });

  it("asks the backend only once per worker instance", async () => {
    const { posts, fetchMock } = stubFetch();
    installWorkerReporter({ app: "storefront" });
    reportWorkerError(new Error("one"));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    reportWorkerError(new Error("two"));
    await vi.waitFor(() => expect(posts).toHaveLength(2));

    const configCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input).includes("observability-config"),
    );
    expect(configCalls).toHaveLength(1);
  });
});
