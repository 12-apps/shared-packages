import { afterEach, describe, expect, it } from "vitest";

import {
  PRESENCE_TOPIC,
  PresenceTracker,
  presenceChangesOf,
  type PresenceChange,
} from "../../core/presence";
import { publishRealtimeEvent, resetRealtimeRuntime } from "../../core/runtime";
import { verifyRealtimeTicket } from "../../core/ticket";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { createApiEvents } from "../create-api-events";
import { PT_BR_EVENTS_MESSAGES } from "../pt-BR";
import type { EventsAuthorization, EventsRoute } from "../types";

/**
 * The API half of connection-lifetime presence.
 *
 * Three promises, each a way a host would otherwise draw somebody wrongly:
 *  - the SSE stream holds its grant's keys for exactly its own life, so a browser
 *    demoted to SSE is as present as one on the socket;
 *  - the ticket carries the SAME keys to the gateway, so the two wires cannot
 *    disagree about who is here;
 *  - the host's listener hears every holder through the bus — this process's
 *    streams and a gateway's sockets alike — and only where the host asked for it.
 */

const SECRET = "server-presence-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface HarnessOptions {
  grant?: EventsAuthorization;
  listen?: boolean;
}

/** One seat-shaped surface over an inline bus, started. */
async function harness(options: HarnessOptions = {}) {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  const heard: PresenceChange[] = [];
  const api = createApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
    logger: silentLogger,
    driver,
    ticketSecret: SECRET,
    installSignalHooks: false,
    ...(options.listen === false ? {} : { presence: { onChange: (change) => void heard.push(change), releaseGraceMs: 0 } }),
    surfaces: [
      {
        name: "seat",
        path: "/seat/:slug/realtime",
        topicsQuery: false,
        domains: [],
        authorize: () =>
          Promise.resolve(
            options.grant ?? {
              subjectId: "p-1",
              topics: ["tenant:t-1:comanda:s-1"],
              presence: ["seat:t-1:s-1:p-1"],
            },
          ),
      },
    ],
  });
  await api.start();
  const route = (method: "GET" | "POST"): EventsRoute => {
    const found = api.routes.find((candidate) => candidate.method === method);
    if (!found) throw new Error(`no ${method} route`);
    return found;
  };
  return {
    api,
    driver,
    heard,
    stream: () => route("GET").handle({ params: { slug: "loja" }, query: {} }),
    ticket: () => route("POST").handle({ params: { slug: "loja" }, query: {} }),
  };
}

/** Let fire-and-forget publishes and the listener's chains settle. */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

/** The client walks away: cancel the stream's body, as the runtime does on disconnect. */
async function disconnect(result: Awaited<ReturnType<EventsRoute["handle"]>>): Promise<void> {
  if (!("response" in result)) throw new Error("expected a stream");
  await result.response.body?.cancel();
}

/** Shut the factory down — behind a name, for the flakiness gate. */
async function shutDown(api: { stop(): Promise<void> }): Promise<void> {
  await api.stop();
}

afterEach(() => {
  resetRealtimeRuntime();
});

describe("createApiEvents — presence on the SSE wire", () => {
  it("holds the grant's keys while the stream is open and releases them when it ends", async () => {
    const h = await harness();
    const opened = await h.stream();
    await settle();
    expect(h.heard).toEqual([{ key: "seat:t-1:s-1:p-1", state: "held" }]);

    await disconnect(opened);
    await settle();
    expect(h.heard).toEqual([
      { key: "seat:t-1:s-1:p-1", state: "held" },
      { key: "seat:t-1:s-1:p-1", state: "released" },
    ]);
    expect(h.api.presence.size).toBe(0);
  });

  it("releases every held key on shutdown, before the bus is stopped", async () => {
    const h = await harness();
    await h.stream();
    await settle();
    await shutDown(h.api);
    const released = h.driver.published
      .filter((record) => record.topic === PRESENCE_TOPIC)
      .flatMap((record) => presenceChangesOf(record.event))
      .filter((change) => change.state === "released");
    expect(released).toEqual([{ key: "seat:t-1:s-1:p-1", state: "released" }]);
  });

  it("refuses a grant whose presence keys the transports cannot carry", async () => {
    const h = await harness({
      grant: { subjectId: "p-1", topics: ["tenant:t-1:comanda:s-1"], presence: ["has space"] },
    });
    expect(await h.stream()).toMatchObject({ status: 503 });
    expect(await h.ticket()).toMatchObject({ status: 503 });
    await settle();
    expect(h.heard).toEqual([]);
  });

  it("holds nothing for a grant that names no key", async () => {
    const h = await harness({ grant: { subjectId: "t-1", topics: ["tenant:t-1:kitchen"] } });
    await disconnect(await h.stream());
    await settle();
    expect(h.heard).toEqual([]);
  });
});

describe("createApiEvents — presence on the WebSocket wire", () => {
  it("signs the SAME keys into the ticket, for the gateway to hold", async () => {
    const h = await harness();
    const answer = await h.ticket();
    if (!("body" in answer)) throw new Error("expected json");
    const { ticket } = (answer.body as { data: { ticket: string } }).data;
    expect(verifyRealtimeTicket(ticket, SECRET)?.presence).toEqual(["seat:t-1:s-1:p-1"]);
    // Minting holds nothing: the socket that uses the ticket does, in its own process.
    await settle();
    expect(h.heard).toEqual([]);
  });

  it("hears a GATEWAY's holder through the bus, exactly like its own streams", async () => {
    const h = await harness();
    // A gateway process is just another tracker publishing on the same bus.
    const gateway = new PresenceTracker({ logger: silentLogger });
    gateway.hold(["seat:t-1:s-1:p-2"])();
    await settle();
    expect(h.heard).toEqual([
      { key: "seat:t-1:s-1:p-2", state: "held" },
      { key: "seat:t-1:s-1:p-2", state: "released" },
    ]);
  });

  it("listens only where the host asked — connections still hold their keys either way", async () => {
    const h = await harness({ listen: false });
    await h.stream();
    await settle();
    expect(h.heard).toEqual([]);
    expect(h.api.presence.size).toBe(1);
    // And a stray event on the reserved topic reaches no host code at all.
    await publishRealtimeEvent(PRESENCE_TOPIC, { type: "presence.held", data: { keys: ["x"] } });
    expect(h.heard).toEqual([]);
  });
});
