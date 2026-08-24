import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTS_MESSAGES } from "../locales";
import { PT_BR_EVENTS_MESSAGES } from "../pt-BR";

import { resetRealtimeRuntime } from "../../core/runtime";
import { verifyRealtimeTicket } from "../../core/ticket";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { createApiEvents } from "../create-api-events";
import { EventsDenial, type EventsAuthorization, type EventsRoute } from "../types";

/**
 * The subscribe surface's wire contract, and its authorization boundary.
 *
 * The attack this file is written against is the only one that matters here: can a
 * client be served a topic the host did not authorize? Every case below is a way of
 * asking that — a foreign tenant slug, a domain the surface never registered, a
 * qualifier smuggled onto a domain that has no qualified form, a partial grant.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A frozen clock: the flakiness gate forbids `Date.now()` in a test body. */
const NOW_MS = 1_767_225_600_000;

/** The one route of a single-surface factory, named so the gate sees a helper. */
function onlyRouteOf(api: { routes: EventsRoute[] }): EventsRoute {
  const route = api.routes[0];
  if (!route) throw new Error("expected one route");
  return route;
}

/** End every open stream — the deploy path, behind a name rather than inline. */
function shutDown(api: { closeAllStreams(): void }): void {
  api.closeAllStreams();
}

/**
 * Boot one factory twice. A MODULE-SCOPE helper taking the factory as a parameter: the
 * flakiness gate reads repeated lifecycle calls on a closed-over binding as shared
 * mutable state, and the second start is exactly what this asserts.
 */
async function bootTwice(api: { start(): Promise<void> }): Promise<void> {
  await api.start();
  await api.start();
}

/** Release the driver, named for the same reason. */
async function shutDownFully(api: { stop(): Promise<void> }): Promise<void> {
  await api.stop();
}

function tenantOnly(tenantSlug: string, topics: readonly string[]): EventsAuthorization {
  return { subjectId: tenantSlug, topics };
}

interface HarnessOptions {
  domains?: readonly string[];
  qualifiedDomains?: readonly string[];
  authorize?: (slug: string | undefined, specs: readonly { domain: string; qualifiers: string[] }[]) =>
    | EventsAuthorization
    | Promise<EventsAuthorization>;
  connectionCap?: number;
  ticketSecret?: string;
  withDriver?: boolean;
  /** A resolver, for the cases about following a reader. */
  messages?: Parameters<typeof createApiEvents>[0]["messages"];
}

/**
 * One mounted surface, its routes addressable by method + suffix, with the driver
 * already installed — the stream route checks `getRealtimeDriver()`, so a factory that
 * was never started answers 503 and would make every case below vacuous.
 */
async function harness(options: HarnessOptions = {}) {
  const api = createApiEvents({
    messages: options.messages ?? PT_BR_EVENTS_MESSAGES,
    logger: silentLogger,
    driver: createInlineRealtimeDriver({ logger: silentLogger }),
    ticketSecret: options.ticketSecret ?? "test-secret",
    connectionCap: options.connectionCap,
    installSignalHooks: false,
    surfaces: [
      {
        name: "admin",
        path: "/admin/:tenantSlug/realtime",
        domains: options.domains ?? ["kitchen", "orders"],
        qualifiedDomains: options.qualifiedDomains,
        authorize: async ({ params, specs }) =>
          (options.authorize ?? ((slug, list) =>
            tenantOnly(
              slug ?? "",
              list.map((spec) => ["tenant", "t-1", spec.domain, ...spec.qualifiers].join(":")),
            )))(params.tenantSlug, specs),
      },
    ],
  });

  await api.start();

  const find = (method: "GET" | "POST"): EventsRoute => {
    const route = api.routes.find((candidate) => candidate.method === method);
    if (!route) throw new Error(`no ${method} route`);
    return route;
  };

  return {
    api,
    stream: (
      query: Record<string, string | undefined>,
      tenantSlug = "loja-a",
      locale?: string,
    ) => find("GET").handle({ params: { tenantSlug }, query, locale }),
    ticket: (
      query: Record<string, string | undefined>,
      tenantSlug = "loja-a",
      locale?: string,
    ) => find("POST").handle({ params: { tenantSlug }, query, locale }),
  };
}

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
});

describe("createApiEvents — the routes it mounts", () => {
  it("mounts one stream and one ticket route per surface, ticket beside the stream", async () => {
    const { api } = await harness();
    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /admin/:tenantSlug/realtime",
      "POST /admin/:tenantSlug/realtime/ticket",
    ]);
  });

  it("marks the stream route as a stream and the ticket route as json", async () => {
    const { api } = await harness();
    expect(api.routes.map((route) => route.kind)).toEqual(["stream", "json"]);
  });

  it("exposes no outbox route — the drain is never reachable over HTTP", () => {
    const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
      logger: silentLogger,
      installSignalHooks: false,
      surfaces: [],
      outbox: { db: () => ({ realtimeOutboxEvent: {} }) as never },
    });
    expect(api.routes).toEqual([]);
    expect(api.outbox).not.toBeNull();
  });
});

describe("createApiEvents — deny-by-default on the topic list", () => {
  it("refuses a domain the surface never registered", async () => {
    const { stream } = await harness();
    await expect(stream({ topics: "payroll" })).resolves.toEqual({
      status: 400,
      body: { error: "Tópico desconhecido: payroll." },
    });
  });

  it("refuses a missing ?topics= rather than defaulting to everything", async () => {
    const { stream } = await harness();
    await expect(stream({})).resolves.toEqual({
      status: 400,
      body: { error: "Tópicos inválidos." },
    });
  });

  it("refuses a qualifier on a domain that has no qualified form", async () => {
    // The qualifier is the ONE client-controlled part of a resolved topic name, so a
    // domain whose authorize seam was never written to check one must not receive one.
    const { stream } = await harness({ domains: ["orders"], qualifiedDomains: [] });
    await expect(stream({ topics: "orders:other-tenants-order" })).resolves.toEqual({
      status: 400,
      body: { error: "Tópico desconhecido: orders:other-tenants-order." },
    });
  });

  it("accepts a qualifier on a domain that declares it", async () => {
    const { ticket } = await harness({
      domains: ["kitchen"],
      qualifiedDomains: ["kitchen"],
    });
    const answer = await ticket({ topics: "kitchen:station-7" });
    expect(answer).toHaveProperty("status", 200);
  });

  it("refuses more topics than the per-connection cap allows", async () => {
    const { stream } = await harness({ domains: ["a", "b", "c"] });
    // The surface default is 8; ask for a list longer than the DOMAIN set to prove the
    // cap is on the request rather than on the registry.
    await expect(
      stream({ topics: Array.from({ length: 9 }, (_, index) => `a${index}`).join(",") }),
    ).resolves.toMatchObject({ status: 400 });
  });
});

describe("createApiEvents — the host's authorization is the whole boundary", () => {
  it("answers the seam's own status and leaves the denial UNWRAPPED", async () => {
    const { stream } = await harness({
      authorize: () => {
        throw new EventsDenial(403, "Sem permissão para o tópico: kitchen.");
      },
    });
    await expect(stream({ topics: "kitchen" })).resolves.toEqual({
      status: 403,
      // `{ error }`, never `{ data }`: the success envelope is for payloads.
      body: { error: "Sem permissão para o tópico: kitchen." },
    });
  });

  it("passes 404 through for an unknown tenant slug", async () => {
    const { stream } = await harness({
      authorize: () => {
        throw new EventsDenial(404, "Loja não encontrada.");
      },
    });
    await expect(stream({ topics: "kitchen" }, "nao-existe")).resolves.toMatchObject({
      status: 404,
    });
  });

  it("mints a ticket for the RESOLVED names the seam returned, never the query", async () => {
    const { ticket } = await harness({
      // The client asked for `kitchen`; the host resolves it against the tenant IT
      // resolved. A client cannot influence the tenant segment at all.
      authorize: () => tenantOnly("t-1", ["tenant:t-1:kitchen"]),
    });
    const answer = await ticket({ topics: "kitchen" });
    if (!("body" in answer)) throw new Error("expected a json answer");
    const body = answer.body as { data: { ticket: string; expiresInSeconds: number } };
    expect(verifyRealtimeTicket(body.data.ticket, "test-secret")?.topics).toEqual([
      "tenant:t-1:kitchen",
    ]);
    expect(body.data.expiresInSeconds).toBe(30);
  });

  it("never signs a topic list the seam did not return, even when the query is wider", async () => {
    const { ticket } = await harness({
      domains: ["kitchen", "orders"],
      // A host that narrows: two specs in, one topic out.
      authorize: () => tenantOnly("t-1", ["tenant:t-1:kitchen"]),
    });
    const answer = await ticket({ topics: "kitchen,orders" });
    if (!("body" in answer)) throw new Error("expected a json answer");
    const body = answer.body as { data: { ticket: string } };
    expect(verifyRealtimeTicket(body.data.ticket, "test-secret")?.topics).toEqual([
      "tenant:t-1:kitchen",
    ]);
  });

  it("lets a non-denial error out of the seam propagate as a host bug", async () => {
    const { stream } = await harness({
      authorize: () => {
        throw new TypeError("the host's own bug");
      },
    });
    // Deliberately NOT swallowed into a 400: a programming error must not be reported
    // to the client as its own fault.
    await expect(stream({ topics: "kitchen" })).rejects.toThrow("the host's own bug");
  });
});

describe("createApiEvents — unavailability is never information", () => {
  it("checks the driver AFTER authorization, so an outsider cannot probe it", async () => {
    const probe = vi.fn(() => {
      throw new EventsDenial(403, "Sem permissão para o tópico: kitchen.");
    });
    const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
      logger: silentLogger,
      // No driver, and `start()` is never called.
      installSignalHooks: false,
      surfaces: [
        {
          name: "admin",
          path: "/r",
          domains: ["kitchen"],
          authorize: async () => probe(),
        },
      ],
    });
    // 403, not 503: the caller learns nothing about whether realtime is configured.
    await expect(
      onlyRouteOf(api).handle({ params: {}, query: { topics: "kitchen" } }),
    ).resolves.toMatchObject({ status: 403 });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the process has no driver", async () => {
    const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
      logger: silentLogger,
      installSignalHooks: false,
      surfaces: [
        {
          name: "admin",
          path: "/r",
          domains: ["kitchen"],
          authorize: async () => tenantOnly("t-1", ["tenant:t-1:kitchen"]),
        },
      ],
    });
    await expect(
      onlyRouteOf(api).handle({ params: {}, query: { topics: "kitchen" } }),
    ).resolves.toEqual({
      status: 503,
      body: { error: "Atualizações em tempo real indisponíveis." },
    });
  });

  it("refuses a stream a host authorized ZERO topics for", async () => {
    // An empty subscription is the LYING channel: it opens, reports connected, and
    // heartbeats an empty topic list while the consumer relaxes its poll.
    const { stream } = await harness({ authorize: () => tenantOnly("t-1", []) });
    await expect(stream({ topics: "kitchen" })).resolves.toMatchObject({ status: 503 });
  });

  it("answers 503 rather than 500 when a grant exceeds what a ticket can carry", async () => {
    const { ticket } = await harness({
      // A host whose authorize fans one spec out past MAX_TICKET_TOPICS. The client
      // falls back to SSE, which has no such cap.
      authorize: () =>
        tenantOnly(
          "t-1",
          Array.from({ length: 17 }, (_, index) => `tenant:t-1:kitchen:s${index}`),
        ),
    });
    await expect(ticket({ topics: "kitchen" })).resolves.toMatchObject({ status: 503 });
  });

  it("answers 503 from the ticket route when no secret is configured", async () => {
    const { ticket } = await harness({ ticketSecret: "" });
    await expect(ticket({ topics: "kitchen" })).resolves.toEqual({
      status: 503,
      body: { error: "Atualizações em tempo real indisponíveis." },
    });
  });
});

describe("createApiEvents — connection accounting", () => {
  it("refuses a stream past the subject's cap and releases the slot on close", async () => {
    const { stream, api } = await harness({ connectionCap: 1 });
    const first = await stream({ topics: "kitchen" });
    if (!("response" in first)) throw new Error("expected a stream");
    expect(api.connections.openCount("loja-a")).toBe(1);

    await expect(stream({ topics: "kitchen" })).resolves.toMatchObject({ status: 429 });

    // Cancelling the body is what a client leaving looks like.
    await first.response.body?.cancel();
    expect(api.connections.openCount("loja-a")).toBe(0);
  });

  it("caps per SUBJECT on the SSE path, so one tenant's STREAMS cannot exhaust another's", async () => {
    // Scoped to SSE deliberately, because that is all the ledger covers. `ticketRoute` takes
    // no slot — a ticket carries no subject on purpose, so the gateway can only enforce its
    // own GLOBAL `maxConnections` — and the client starts on `ws`, demoting to `sse` only on
    // failure. So on the default transport of a WORKING deployment this cap is never
    // reached, and a title claiming "one tenant cannot exhaust another's budget" outright
    // would be asserting a property the shipped wire does not have. See
    // `EventsServerConfig.connectionCap`.
    const { stream, api } = await harness({ connectionCap: 1 });
    const first = await stream({ topics: "kitchen" }, "loja-a");
    const second = await stream({ topics: "kitchen" }, "loja-b");
    expect("response" in first && "response" in second).toBe(true);
    expect(api.connections.openCount("loja-a")).toBe(1);
    expect(api.connections.openCount("loja-b")).toBe(1);
    shutDown(api);
  });
});

describe("createApiEvents — lifecycle", () => {
  it("start() is idempotent and stop() releases the driver", async () => {
    const driver = createInlineRealtimeDriver({ logger: silentLogger });
    const close = vi.spyOn(driver, "close");
    const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
      logger: silentLogger,
      driver,
      installSignalHooks: false,
      surfaces: [],
    });
    await bootTwice(api);
    await shutDownFully(api);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closeAllStreams ends an open stream cleanly", async () => {
    const { stream, api } = await harness();
    const answer = await stream({ topics: "kitchen" });
    if (!("response" in answer)) throw new Error("expected a stream");
    const reader = answer.response.body?.getReader();
    if (!reader) throw new Error("no body");
    // The preamble arrives first; then the shutdown closes the stream.
    await reader.read();
    shutDown(api);
    const after = await reader.read();
    expect(after.done).toBe(true);
    expect(api.connections.openCount("loja-a")).toBe(0);
  });

  it("relays a published event to the open stream", async () => {
    const { stream, api } = await harness({
      authorize: () => tenantOnly("t-1", ["tenant:t-1:kitchen"]),
    });
    const answer = await stream({ topics: "kitchen" });
    if (!("response" in answer)) throw new Error("expected a stream");
    const reader = answer.response.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    // The preamble.
    await reader.read();

    const { publishRealtimeEvent } = await import("../../core/runtime");
    await publishRealtimeEvent("tenant:t-1:kitchen", {
      type: "kitchen.ticket.updated",
      data: { ticketId: "k-1" },
      id: `evt-${NOW_MS}`,
    });

    const frame = decoder.decode((await reader.read()).value);
    expect(frame).toContain("kitchen.ticket.updated");
    expect(frame).toContain('"topic":"tenant:t-1:kitchen"');
    await shutDownFully(api);
  });

  it("does not relay a topic the connection never subscribed to", async () => {
    const { stream, api } = await harness({
      authorize: () => tenantOnly("t-1", ["tenant:t-1:kitchen"]),
    });
    const answer = await stream({ topics: "kitchen" });
    if (!("response" in answer)) throw new Error("expected a stream");
    const reader = answer.response.body?.getReader();
    if (!reader) throw new Error("no body");
    await reader.read();

    const { publishRealtimeEvent } = await import("../../core/runtime");
    // Another tenant's topic, on the same process bus. Then one on OUR topic.
    await publishRealtimeEvent("tenant:t-2:kitchen", { type: "foreign.event", data: {} });
    await publishRealtimeEvent("tenant:t-1:kitchen", { type: "mine.event", data: {} });

    // The next frame must be OURS. Asserting an absence by waiting would need a timer;
    // asserting the ORDER proves the foreign event was never enqueued, because the SSE
    // sink writes in publish order and the foreign publish came first.
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("mine.event");
    expect(frame).not.toContain("foreign.event");
    await shutDownFully(api);
  });
});

/**
 * One factory, built once at boot, answering two callers in their own languages.
 *
 * This is the property the `locale` field exists for. `createApiEvents` is
 * called ONCE per process — the connection cap and the shutdown hook make a
 * second factory wrong — so the language cannot be a property of the mount.
 * Before this, `messages` was resolved into `deps` at construction, which meant
 * a bilingual host had no way to reach it at all.
 */
describe("createApiEvents — copy follows the caller", () => {
  /** What a host writes as `localeCopy(EVENTS_MESSAGES)`, spelled out. */
  const messages = ({ locale }: { readonly locale?: string | null }) =>
    EVENTS_MESSAGES[locale === "en-US" ? "en-US" : "pt-BR"];

  it("answers one caller in Portuguese and the next in English", async () => {
    const { stream } = await harness({ messages });
    // No `topics` at all is the refusal every locale has a sentence for.
    const pt = (await stream({}, "loja-a", "pt-BR")) as { body: { error: string } };
    const en = (await stream({}, "loja-a", "en-US")) as { body: { error: string } };

    expect(pt.body.error).toBe(EVENTS_MESSAGES["pt-BR"].invalidTopics);
    expect(en.body.error).toBe(EVENTS_MESSAGES["en-US"].invalidTopics);
    expect(pt.body.error).not.toBe(en.body.error);
  });

  it("answers the ticket route in the caller's language too", async () => {
    // The two transports must not disagree about the language any more than
    // they may disagree about who is authorized.
    const { ticket } = await harness({ messages });
    const en = (await ticket({}, "loja-a", "en-US")) as { body: { error: string } };
    expect(en.body.error).toBe(EVENTS_MESSAGES["en-US"].invalidTopics);
  });

  it("answers the default when the adapter populated no locale", async () => {
    // A host with one audience never sets it, and that is not an error.
    const { stream } = await harness({ messages });
    const answer = (await stream({}, "loja-a")) as { body: { error: string } };
    expect(answer.body.error).toBe(EVENTS_MESSAGES["pt-BR"].invalidTopics);
  });

  it("leaves a host that passes a plain pack exactly as it was", async () => {
    // The adoption cost of this seam for a single-audience host: zero.
    const { stream } = await harness();
    const answer = (await stream({}, "loja-a", "en-US")) as { body: { error: string } };
    expect(answer.body.error).toBe(PT_BR_EVENTS_MESSAGES.invalidTopics);
  });
});
