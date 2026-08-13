import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTROL_TOPIC } from "../liveness";
import { MAX_TOPICS_PER_TICKET, SharedRealtimeChannel } from "../shared-channel";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransport,
  WireSource,
} from "../types";

/**
 * `SharedRealtimeChannel` — the one connection whose SUBSCRIPTION moves underneath it.
 *
 * The most intricate module in the browser half, and it was reached only indirectly: through
 * `createLocalHost` in `web-events.test.tsx` (which injects `createSource`, so `canSend` is
 * false and the whole WebSocket branch is dark) and through the browser harness (a two-topic
 * union that never changes after mount). So everything that makes a MUTABLE live
 * subscription hard went unexercised: `widen`, `drop`, the `MAX_TOPICS_PER_TICKET` paging,
 * the `generation` guards around the ticket round trip, the `reconciling` serialisation and
 * the `resubscribing` suppression.
 *
 * Each case below drives one of those, against a fake wire that can `send` — because the
 * asymmetry between the two transports lives here and only here:
 *
 *   - on a WebSocket the union is mutated IN PLACE (mint a ticket for what was added, push
 *     `subscribe`, push `unsubscribe` for what went away);
 *   - on SSE there is no back channel at all, so a changed union means a NEW stream.
 */

/**
 * A wire the test drives, with a real `send` — so `canSend` is true and the channel takes
 * its WebSocket branch.
 *
 * `sse: true` omits `send` entirely, which is how the channel is told this wire has no back
 * channel (`WireSource.send` is optional on purpose, so a caller ASKS rather than
 * discovering at runtime that its frame went nowhere).
 */
function fakeWire(options: { sse?: boolean } = {}) {
  const built: { url: string; transport: RealtimeTransport; source: FakeSource }[] = [];
  const sent: unknown[] = [];

  /**
   * No `send` on the class, deliberately: the SSE case needs a source that genuinely LACKS
   * the method (`canSend` is `typeof source.send === "function"`), and deleting an inherited
   * prototype method off an instance does nothing — which is exactly how an SSE fake ends up
   * silently exercising the WebSocket branch instead.
   */
  class FakeSource implements WireSource {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    closed = false;
    close(): void {
      this.closed = true;
    }
  }

  return {
    built,
    sent,
    /** Every frame of one verb, in order. */
    framesOf: (type: string): Record<string, unknown>[] =>
      sent.filter((frame): frame is Record<string, unknown> => {
        return typeof frame === "object" && frame !== null && (frame as { type?: string }).type === type;
      }),
    /** Every subscribe URL the channel has opened, in order. */
    urls: (): string[] => built.map((entry) => entry.url),
    live: (): FakeSource => {
      const last = built.at(-1)?.source;
      if (!last) throw new Error("no wire was built");
      return last;
    },
    factory: (url: string, transport: RealtimeTransport): WireSource => {
      const source = new FakeSource();
      built.push({ url, transport, source });
      // SSE has no back channel at all; a WebSocket does. `WireSource.send` is optional for
      // exactly this reason, so a caller ASKS (`channel.canSend`) rather than discovering at
      // runtime that its frame went nowhere.
      if (!options.sse) {
        (source as WireSource).send = (payload: string): boolean => {
          if (source.closed) return false;
          sent.push(JSON.parse(payload));
          return true;
        };
      }
      return source;
    },
  };
}

/** A channel plus everything a case needs to observe and drive it. */
function harness(options: { sse?: boolean; tickets?: () => Promise<string> } = {}) {
  const wire = fakeWire({ sse: options.sse });
  const statuses: RealtimeStatus[] = [];
  const messages: RealtimeMessage[] = [];
  const minted: string[] = [];
  const channel = new SharedRealtimeChannel({
    endpoint: "/api/admin/loja-a/realtime",
    createSource: wire.factory,
    onMessage: (message) => messages.push(message),
    onStatusChange: (status) => statuses.push(status),
    transport: {
      fetchTicket: async (ticketUrl) => {
        minted.push(ticketUrl);
        return options.tickets ? options.tickets() : `ticket-for-${minted.length}`;
      },
    },
  });
  return { channel, wire, statuses, messages, minted };
}

/**
 * Drain the microtask queue.
 *
 * `reconcile` is a chain of promises with no scheduled work (`send` → `mintTicketFor` →
 * `send`), so draining is exact where a timer would be a guess — the same reasoning the
 * gateway suite's `settle` uses.
 */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

/** The wire opening — an event, not a user action. */
async function goLive(harnessed: ReturnType<typeof harness>): Promise<void> {
  harnessed.wire.live().onopen?.({});
  await settle();
}

/** The gateway reporting the RESOLVED names it serves, which is the only place they exist. */
async function serves(harnessed: ReturnType<typeof harness>, topics: string[]): Promise<void> {
  harnessed.wire.live().onmessage?.({
    data: JSON.stringify({
      topic: CONTROL_TOPIC,
      type: "subscribed",
      data: { topics },
      ts: 0,
      id: "control-1",
    }),
  });
  await settle();
}

const topicList = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `d-${index}`);

afterEach(() => {
  vi.useRealTimers();
});

describe("SharedRealtimeChannel — opening", () => {
  it("puts the union in the subscribe URL and reports connecting", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen", "orders"]);
    await settle();
    expect(events.wire.urls()).toEqual(["/api/admin/loja-a/realtime?topics=kitchen%2Corders"]);
    expect(events.statuses).toEqual(["connecting"]);
    events.channel.close();
  });

  it("closes and reports disconnected when the union empties", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen"]);
    await settle();
    const source = events.wire.live();
    events.channel.setTopics([]);
    expect(source.closed).toBe(true);
    expect(events.statuses.at(-1)).toBe("disconnected");
    events.channel.close();
  });

  it("does nothing at all after close", async () => {
    const events = harness();
    events.channel.close();
    events.channel.setTopics(["kitchen"]);
    await settle();
    expect(events.wire.urls()).toEqual([]);
  });
});

/**
 * The paging `MAX_TOPICS_PER_TICKET` forces.
 *
 * The cap is the SIGNED PAYLOAD's, because a ticket travels in a query string — so it bounds
 * one MINT, not the subscription. A union over the cap is not refused: the connection opens
 * with the first chunk and the rest arrive as `subscribe` frames, one ticket each. That
 * matters more under a SharedWorker, where the union is across TABS rather than one page.
 */
describe("SharedRealtimeChannel — one ticket per chunk", () => {
  it("opens with the first chunk and pages the remainder in, one ticket each", async () => {
    const events = harness();
    events.channel.setTopics(topicList(MAX_TOPICS_PER_TICKET * 2 + 3));
    await goLive(events);

    // The URL carries exactly the cap — never the whole union, which would be a ticket
    // nothing can sign.
    const [url] = events.wire.urls();
    expect(decodeURIComponent(url ?? "").split("topics=")[1]?.split(",")).toHaveLength(
      MAX_TOPICS_PER_TICKET,
    );
    // Two more chunks: 16 + 3. One ticket per chunk, and each ticket's URL names only its
    // own chunk, so a mint can never exceed the cap either.
    expect(events.minted).toHaveLength(2);
    expect(events.wire.framesOf("subscribe")).toHaveLength(2);
    expect(decodeURIComponent(events.minted[1] ?? "")).toContain("d-32,d-33,d-34");
    events.channel.close();
  });

  it("mints nothing when the union fits in the handshake", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen", "orders"]);
    await goLive(events);
    // A `ping` and nothing else: paging costs nothing when there is nothing to page.
    expect(events.minted).toEqual([]);
    expect(events.wire.framesOf("subscribe")).toEqual([]);
    expect(events.wire.framesOf("ping")).toHaveLength(1);
    events.channel.close();
  });

  it("asks for the served list on connect rather than waiting for a heartbeat", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    // Until that list arrives there is no way to SPELL an unsubscribe — waiting up to 25 s
    // for the heartbeat would make the first narrowing after a connect a no-op.
    expect(events.wire.framesOf("ping")).toHaveLength(1);
    events.channel.close();
  });
});

describe("SharedRealtimeChannel — widening a live subscription", () => {
  it("mints for the ADDED topics only and pushes one subscribe", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen"]);
    await goLive(events);

    events.channel.setTopics(["kitchen", "orders"]);
    await settle();
    // One connection throughout: widening is a frame, not a reconnect. That is the whole
    // point of FUT-644 — before it, a route change meant a new handshake, and under the
    // socket a handshake is a ticket POST plus a full authorization pass.
    expect(events.wire.urls()).toHaveLength(1);
    expect(events.minted).toHaveLength(1);
    expect(decodeURIComponent(events.minted[0] ?? "")).toContain("topics=orders");
    expect(events.wire.framesOf("subscribe")).toEqual([
      { type: "subscribe", ticket: "ticket-for-1" },
    ]);
    events.channel.close();
  });

  it("leaves the union short rather than reconnecting when a ticket is refused", async () => {
    const events = harness({ tickets: () => Promise.reject(new Error("401")) });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);

    events.channel.setTopics(["kitchen", "orders"]);
    await settle();
    // Every consumer still has its polling fallback — the documented degraded mode — and the
    // next union change tries again. Reconnecting here would trade a missing topic for a
    // dropped stream on every other screen.
    expect(events.wire.framesOf("subscribe")).toEqual([]);
    expect(events.statuses).toEqual(["connecting", "connected"]);
    events.channel.close();
  });

  it("DROPS a ticket minted for a connection that no longer exists", async () => {
    const gate: { release: (ticket: string) => void } = { release: () => {} };
    const pending = new Promise<string>((resolve) => {
      gate.release = resolve;
    });
    const events = harness({ tickets: () => pending });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    events.channel.setTopics(["kitchen", "orders"]);
    await settle();

    // The channel is torn down mid-round-trip: a route change, a tenant switch, an unmount.
    events.channel.setTopics([]);
    gate.release("stale-ticket");
    await settle();

    // The `generation` guard: this ticket describes a socket that is gone, and pushing it
    // would widen whatever connection happens to exist now.
    expect(events.wire.framesOf("subscribe")).toEqual([]);
    events.channel.close();
  });
});

describe("SharedRealtimeChannel — narrowing", () => {
  it("unsubscribes in the SERVER's spelling, not the client's", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen", "orders"]);
    await goLive(events);
    await serves(events, ["tenant:t-1:kitchen", "tenant:t-1:orders"]);

    events.channel.setTopics(["kitchen"]);
    await settle();
    // The client holds domain names; the gateway holds resolved ones, and only the ticket
    // maps between them — a credential the client must never parse. So the resolved list is
    // read off the control frames and matched with the same suffix rule that routes events.
    expect(events.wire.framesOf("unsubscribe")).toEqual([
      { type: "unsubscribe", topics: ["tenant:t-1:orders"] },
    ]);
    events.channel.close();
  });

  it("skips the unsubscribe entirely when the gateway never said its spelling", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen", "orders"]);
    await goLive(events);

    events.channel.setTopics(["kitchen"]);
    await settle();
    // Dropping is an OPTIMISATION — the events would be filtered client-side anyway — so
    // skipping is safe and guessing a name would not be.
    expect(events.wire.framesOf("unsubscribe")).toEqual([]);
    events.channel.close();
  });

  it("forgets the server's spelling when the wire drops, so it cannot be reused", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen", "orders"]);
    await goLive(events);
    await serves(events, ["tenant:t-1:kitchen", "tenant:t-1:orders"]);

    // A reconnect re-runs the handshake, and the gateway that answers is a different
    // process with its own subscription state.
    events.wire.live().onerror?.({});
    await settle();
    await goLive(events);
    events.channel.setTopics(["kitchen"]);
    await settle();
    expect(events.wire.framesOf("unsubscribe")).toEqual([]);
    events.channel.close();
  });
});

describe("SharedRealtimeChannel — overlapping reconciles", () => {
  it("lets the LAST union win, not the slowest", async () => {
    const tickets: { release: ((ticket: string) => void)[] } = { release: [] };
    const events = harness({
      tickets: () =>
        new Promise<string>((resolve) => {
          tickets.release.push(resolve);
        }),
    });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);

    // A widening is in flight when the route changes again — the common case, since the
    // topics a screen wants are usually derived from a read that lands after first render.
    events.channel.setTopics(["kitchen", "orders"]);
    await settle();
    events.channel.setTopics(["kitchen", "orders", "tables"]);
    await settle();
    // Serialised: the second pass has not started, so only one mint is outstanding. Two
    // overlapping passes would each diff against a stale `attached` and re-subscribe what
    // the other had just added.
    expect(tickets.release).toHaveLength(1);

    tickets.release[0]?.("ticket-orders");
    await settle();
    // The trailing re-entry: `desired` moved while we awaited, so reconcile runs again — for
    // `tables` alone, because `orders` is now attached.
    expect(tickets.release).toHaveLength(2);
    expect(decodeURIComponent(events.minted[1] ?? "")).toContain("topics=tables");
    tickets.release[1]?.("ticket-tables");
    await settle();
    expect(events.wire.framesOf("subscribe")).toHaveLength(2);
    events.channel.close();
  });
});

/**
 * SSE: no back channel, so a changed union is a new stream — the pre-FUT-659 behaviour,
 * kept deliberately as the no-regression floor.
 */
describe("SharedRealtimeChannel — the SSE path", () => {
  it("reopens on a new URL instead of pushing frames", async () => {
    const events = harness({ sse: true });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    events.channel.setTopics(["kitchen", "orders"]);
    await settle();

    expect(events.wire.urls()).toEqual([
      "/api/admin/loja-a/realtime?topics=kitchen",
      "/api/admin/loja-a/realtime?topics=kitchen%2Corders",
    ]);
    expect(events.minted).toEqual([]);
    events.channel.close();
  });

  it("SUPPRESSES the connecting that a routine resubscribe would announce", async () => {
    const events = harness({ sse: true });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    expect(events.statuses).toEqual(["connecting", "connected"]);

    events.channel.setTopics(["kitchen", "orders"]);
    await settle();
    await goLive(events);
    // From a screen's point of view its subscription never lapsed. A consumer that re-reads
    // on every return to `connected` would otherwise treat a routine station switch as
    // recovery from a dropped stream and issue its widest invalidation — right behind the
    // read the switch itself just triggered.
    //
    // Filtered rather than compared literally: the new channel re-announces `connected`,
    // which is idempotent for every consumer (the provider's `setStatus` with the same value
    // re-renders nothing). What must not appear is a TRANSITION away from connected.
    expect(events.statuses.filter((status) => status !== "connected")).toEqual(["connecting"]);
    events.channel.close();
  });

  it("lets a REAL failure through, so the suppression covers a round trip only", async () => {
    const events = harness({ sse: true });
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    events.channel.setTopics(["kitchen", "orders"]);
    await settle();

    // The new stream genuinely fails. `connecting` was held; `disconnected` is not — and it
    // CLEARS the flag, so the retry's own `connecting` goes through too. The suppression
    // covers a round trip, never a real outage.
    events.wire.live().onerror?.({});
    await settle();
    expect(events.statuses).toEqual(["connecting", "connected", "disconnected", "connecting"]);
    events.channel.close();
  });

  it("does NOT reopen for a union change past the ticket cap", async () => {
    const events = harness({ sse: true });
    events.channel.setTopics(topicList(MAX_TOPICS_PER_TICKET));
    await goLive(events);
    // Only the first chunk is comparable — that is all a URL can carry. Comparing the whole
    // union would find a permanent disagreement whenever it exceeds the cap, and every
    // status change would reopen the channel to satisfy it: a reconnect loop, on exactly the
    // subscription shape the paging exists to support.
    events.channel.setTopics([...topicList(MAX_TOPICS_PER_TICKET), "extra"]);
    await settle();
    expect(events.wire.urls()).toHaveLength(1);
    events.channel.close();
  });
});

describe("SharedRealtimeChannel — events", () => {
  it("forwards events but never the control frames", async () => {
    const events = harness();
    events.channel.setTopics(["kitchen"]);
    await goLive(events);
    await serves(events, ["tenant:t-1:kitchen"]);
    events.wire.live().onmessage?.({
      data: JSON.stringify({
        topic: "tenant:t-1:kitchen",
        type: "kitchen.changed",
        data: {},
        ts: 0,
        id: "e-1",
      }),
    });
    await settle();
    expect(events.messages.map((message) => message.type)).toEqual(["kitchen.changed"]);
    events.channel.close();
  });
});
