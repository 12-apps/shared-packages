import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { ConnectionLedger, connectionCapFromEnv, DEFAULT_CONNECTION_CAP } from "../connections";
import { parseTopicList, toTopicSpec } from "../registry";
import { resolveRealtimeDriver } from "../resolve-driver";
import { __testables as sse, createEventStreamResponse } from "../sse";
import { createTicketSecretResolver } from "../ticket-secret";
import { EventsDenial } from "../types";

/** The three server-side internals a surface is assembled from. */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

afterEach(() => {
  resetRealtimeRuntime();
  vi.unstubAllEnvs();
});

describe("topic registry", () => {
  const registry = { domains: ["kitchen", "orders"], qualifiedDomains: ["kitchen"] };

  it("parses a bare domain", () => {
    expect(toTopicSpec("orders", registry)).toEqual({ domain: "orders", qualifiers: [] });
  });

  it("parses a qualified domain that declares qualifiers", () => {
    expect(toTopicSpec("kitchen:station-1", registry)).toEqual({
      domain: "kitchen",
      qualifiers: ["station-1"],
    });
  });

  it("refuses an unknown domain", () => {
    expect(toTopicSpec("payroll", registry)).toBeNull();
  });

  it("refuses a qualifier on a domain that does not declare one", () => {
    expect(toTopicSpec("orders:o-1", registry)).toBeNull();
  });

  it("refuses a qualifier that is not a legal topic segment", () => {
    // Vetted here so a bad qualifier is a 400 at the endpoint, never a 500 out of the
    // topic builder.
    expect(toTopicSpec("kitchen:has space", registry)).toBeNull();
    expect(toTopicSpec("kitchen:", registry)).toBeNull();
  });

  it("de-duplicates and trims a comma list", () => {
    expect(parseTopicList(" orders , orders ,kitchen", registry)).toEqual([
      { domain: "orders", qualifiers: [] },
      { domain: "kitchen", qualifiers: [] },
    ]);
  });

  it("refuses an empty list", () => {
    expect(() => parseTopicList(" , ", registry)).toThrow(EventsDenial);
  });

  it("refuses a list over the cap", () => {
    expect(() => parseTopicList("orders,kitchen", registry, 1)).toThrow(EventsDenial);
  });

  it("names the refused entry in the message", () => {
    expect(() => parseTopicList("orders,payroll", registry)).toThrow(/payroll/);
  });
});

describe("connection ledger", () => {
  it("hands out slots up to the cap and releases them idempotently", () => {
    const ledger = new ConnectionLedger({ logger: silentLogger, cap: 2 });
    const first = ledger.acquire("t-1");
    const second = ledger.acquire("t-1");
    expect(ledger.acquire("t-1")).toBeNull();
    expect(ledger.openCount("t-1")).toBe(2);

    first?.();
    first?.();
    expect(ledger.openCount("t-1")).toBe(1);
    second?.();
    expect(ledger.openCount("t-1")).toBe(0);
  });

  it("keeps subjects independent", () => {
    const ledger = new ConnectionLedger({ logger: silentLogger, cap: 1 });
    expect(ledger.acquire("t-1")).not.toBeNull();
    expect(ledger.acquire("t-2")).not.toBeNull();
  });

  it("runs every registered stream closer once, on shutdown", () => {
    const ledger = new ConnectionLedger({ logger: silentLogger });
    const closed: string[] = [];
    ledger.registerStreamCloser(() => closed.push("a"));
    const deregister = ledger.registerStreamCloser(() => closed.push("b"));
    deregister();
    ledger.closeAllStreams();
    ledger.closeAllStreams();
    expect(closed).toEqual(["a"]);
  });

  it("reads the env override, falling back to the default for anything unusable", () => {
    expect(connectionCapFromEnv()).toBe(DEFAULT_CONNECTION_CAP);
    vi.stubEnv("REALTIME_TENANT_CONNECTION_CAP", "5");
    expect(connectionCapFromEnv()).toBe(5);
    vi.stubEnv("REALTIME_TENANT_CONNECTION_CAP", "-1");
    expect(connectionCapFromEnv()).toBe(DEFAULT_CONNECTION_CAP);
    vi.stubEnv("REALTIME_TENANT_CONNECTION_CAP", "banana");
    expect(connectionCapFromEnv(7)).toBe(7);
  });
});

describe("SSE wire format", () => {
  it("renders an event as an id line plus a one-object data line", () => {
    // Byte-identical to the gateway's frame: the browser decodes with ONE function that
    // names neither transport, so changing this shape means changing both together.
    expect(
      sse.frameFor("tenant:t-1:kitchen", {
        type: "kitchen.changed",
        data: { ticketId: "k-1" },
        ts: 5,
        id: "e-1",
      }),
    ).toBe(
      'id: e-1\ndata: {"topic":"tenant:t-1:kitchen","type":"kitchen.changed",' +
        '"data":{"ticketId":"k-1"},"ts":5,"id":"e-1"}\n\n',
    );
  });

  it("makes the heartbeat a real data frame carrying the served topics", () => {
    // A `: hb` COMMENT keeps a proxy alive and never fires `onmessage`, so the page could
    // not tell a quiet store from a broken stream (FUT-657). The topic list rides along
    // because liveness alone would vouch for a stream subscribed to the wrong names.
    const frame = sse.heartbeatFrame(["tenant:t-1:kitchen"], 1_000);
    expect(frame.startsWith("data: ")).toBe(true);
    expect(JSON.parse(frame.slice("data: ".length))).toEqual({
      topic: sse.GATEWAY_TOPIC,
      type: "hb",
      data: { topics: ["tenant:t-1:kitchen"] },
      ts: 1_000,
      id: "hb-1000",
    });
  });

  it("sends the reconnect hint and a connected preamble before anything else", async () => {
    const { configureRealtime } = await import("../../core/runtime");
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const ledger = new ConnectionLedger({ logger: silentLogger });
    const response = await createEventStreamResponse({
      topics: ["tenant:t-1:kitchen"],
      onClose: () => {},
      streams: ledger,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      `retry: ${sse.RETRY_HINT_MS}\n: connected\n\n`,
    );
    await reader.cancel();
  });

  it("sets the headers that stop an intermediary buffering the stream", async () => {
    const { configureRealtime } = await import("../../core/runtime");
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const response = await createEventStreamResponse({
      topics: ["tenant:t-1:kitchen"],
      onClose: () => {},
      streams: new ConnectionLedger({ logger: silentLogger }),
    });
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    await response.body?.cancel();
  });

  it("runs onClose exactly once, and releases the bus subscription", async () => {
    const driver = createInlineRealtimeDriver({ logger: silentLogger });
    const { configureRealtime } = await import("../../core/runtime");
    configureRealtime({ driver, logger: silentLogger });
    const closes = { count: 0 };
    const response = await createEventStreamResponse({
      topics: ["tenant:t-1:kitchen"],
      onClose: () => {
        closes.count += 1;
      },
      streams: new ConnectionLedger({ logger: silentLogger }),
    });
    await response.body?.cancel();
    await response.body?.cancel();
    expect(closes.count).toBe(1);
  });

  it("releases the slot when the subscribe itself fails", async () => {
    // No driver: `subscribeRealtime` throws, and the caller's cleanup must still run —
    // otherwise a bus outage would leak a cap slot per attempt.
    const closes = { count: 0 };
    await expect(
      createEventStreamResponse({
        topics: ["tenant:t-1:kitchen"],
        onClose: () => {
          closes.count += 1;
        },
        streams: new ConnectionLedger({ logger: silentLogger }),
      }),
    ).rejects.toThrow();
    expect(closes.count).toBe(1);
  });
});

describe("ticket secret resolution", () => {
  it("prefers a literal, then the resolver, then the env chain", () => {
    expect(createTicketSecretResolver("literal", silentLogger)()).toBe("literal");
    expect(createTicketSecretResolver(() => "resolved", silentLogger)()).toBe("resolved");
  });

  it("falls back from REALTIME_TICKET_SECRET to AUTH_SECRET", () => {
    // The gateway resolves the two in the SAME order: the halves must agree, and a
    // mismatch would show up as every socket being refused with no other symptom.
    vi.stubEnv("REALTIME_TICKET_SECRET", "dedicated");
    vi.stubEnv("AUTH_SECRET", "session");
    expect(createTicketSecretResolver(undefined, silentLogger)()).toBe("dedicated");
    vi.stubEnv("REALTIME_TICKET_SECRET", "");
    expect(createTicketSecretResolver(undefined, silentLogger)()).toBe("session");
  });

  it("answers null when neither is set, rather than signing with nothing", () => {
    vi.stubEnv("REALTIME_TICKET_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(createTicketSecretResolver(undefined, silentLogger)()).toBeNull();
  });

  it("treats an empty literal as absent", () => {
    expect(createTicketSecretResolver("", silentLogger)()).toBeNull();
  });
});

describe("driver resolution", () => {
  it("uses the inline driver outside production when no Redis is configured", async () => {
    vi.stubEnv("REALTIME_DRIVER", "");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect((await resolveRealtimeDriver(silentLogger))?.kind).toBe("inline");
  });

  it("is OFF in production with no Redis — loudly, so clients keep polling", async () => {
    vi.stubEnv("REALTIME_DRIVER", "");
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await resolveRealtimeDriver(silentLogger)).toBeNull();
  });

  it("refuses the inline driver in production — it cannot cross a process boundary", async () => {
    // A worker's publish would silently never reach a stream held by the web process.
    vi.stubEnv("REALTIME_DRIVER", "inline");
    vi.stubEnv("NODE_ENV", "production");
    expect(await resolveRealtimeDriver(silentLogger)).toBeNull();
  });

  it("refuses an unrecognised REALTIME_DRIVER rather than guessing", async () => {
    vi.stubEnv("REALTIME_DRIVER", "kafka");
    expect(await resolveRealtimeDriver(silentLogger)).toBeNull();
  });

  it("needs REDIS_URL when REALTIME_DRIVER=redis", async () => {
    vi.stubEnv("REALTIME_DRIVER", "redis");
    vi.stubEnv("REDIS_URL", "");
    expect(await resolveRealtimeDriver(silentLogger)).toBeNull();
  });

  it("is explicitly OFF when asked to be", async () => {
    vi.stubEnv("REALTIME_DRIVER", "off");
    vi.stubEnv("NODE_ENV", "test");
    expect(await resolveRealtimeDriver(silentLogger)).toBeNull();
  });
});
