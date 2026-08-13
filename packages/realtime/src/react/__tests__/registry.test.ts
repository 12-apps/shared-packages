/* eslint-disable test-flakiness/no-test-isolation -- every fixture here is built INSIDE its
   own `it` (`hubHarness()`, `new SubscriptionRegistry()`), so there is no state shared between cases. The rule's heuristic
   reads any `const` inside a `describe` as describe-level and then flags ordinary method
   calls on it; the same allowance `packages/prisma/package.test.ts` makes for the same
   misread. Isolation is enforced by construction — a fresh fixture per test — plus the
   `afterEach` resets below. */
import { describe, expect, it } from "vitest";

import {
  mergeTopics,
  sameTopics,
  SubscriptionRegistry,
  topicServes,
} from "../subscription-registry";
import { WorkerHub, type HubChannel, type HubPort } from "../worker/hub";
import { PORT_SILENCE_MS, readTabMessage, type WorkerMessage } from "../worker/protocol";
import type { RealtimeMessage } from "../types";

/**
 * The two union-owners: the registry that merges a page's SCREENS, and the hub that merges
 * a person's TABS. They share `mergeTopics`/`sameTopics` deliberately — two
 * implementations of "what is the union" would be two chances to disagree about whether it
 * moved, and both designs turn on only reacting when it really did.
 */

const NOW_MS = 1_767_225_600_000;

function event(topic: string): RealtimeMessage {
  return { topic, type: "changed", data: {}, ts: NOW_MS, id: `${topic}-1` };
}

describe("topicServes", () => {
  it("matches a resolved topic against the client-side spec that asked for it", () => {
    expect(topicServes("tenant:t-1:kitchen", "kitchen")).toBe(true);
    expect(topicServes("tenant:t-1:research-run:r-9", "research-run:r-9")).toBe(true);
    expect(topicServes("kitchen", "kitchen")).toBe(true);
  });

  it("does NOT match a longer sibling", () => {
    // A screen on `kitchen` is not served by `…:kitchen:station-1`: if it had wanted the
    // station's topic it would have asked, and the unqualified one is a different
    // subscription with different authorization.
    expect(topicServes("tenant:t-1:kitchen:station-1", "kitchen")).toBe(false);
  });

  it("does NOT match a partial segment", () => {
    expect(topicServes("tenant:t-1:my-kitchen", "kitchen")).toBe(false);
  });
});

describe("mergeTopics / sameTopics", () => {
  it("sorts and de-duplicates, so an unchanged set compares equal", () => {
    expect(mergeTopics([["b", "a"], ["a", "c"]])).toEqual(["a", "b", "c"]);
    expect(sameTopics(mergeTopics([["b", "a"]]), mergeTopics([["a", "b"]]))).toBe(true);
    expect(sameTopics(["a"], ["a", "b"])).toBe(false);
  });
});

describe("SubscriptionRegistry", () => {
  it("announces the union only when it really moved", () => {
    const unions: string[][] = [];
    const registry = new SubscriptionRegistry((union) => unions.push([...union]));
    const first = registry.register({ topics: ["kitchen"] });
    // A second screen wanting the SAME domain is the common case when one replaces another.
    const second = registry.register({ topics: ["kitchen"] });
    expect(unions).toEqual([["kitchen"]]);

    second.update({ topics: ["orders"] });
    expect(unions).toEqual([["kitchen"], ["kitchen", "orders"]]);

    first.release();
    expect(unions.at(-1)).toEqual(["orders"]);
  });

  it("routes an event only to the subscriptions that asked for its topic", () => {
    const kitchen: RealtimeMessage[] = [];
    const orders: RealtimeMessage[] = [];
    const registry = new SubscriptionRegistry(() => {});
    registry.register({ topics: ["kitchen"], onMessage: (message) => kitchen.push(message) });
    registry.register({ topics: ["orders"], onMessage: (message) => orders.push(message) });

    registry.deliver(event("tenant:t-1:kitchen"));
    // Before the shared connection, "it arrived" and "it is mine" were the same statement.
    // On a shared one they are not, and a kitchen board that invalidated on a tables event
    // would re-read on every table change in the building.
    expect(kitchen).toHaveLength(1);
    expect(orders).toHaveLength(0);
  });

  it("a released handle stops receiving and stops contributing", () => {
    const seen: RealtimeMessage[] = [];
    const registry = new SubscriptionRegistry(() => {});
    const handle = registry.register({ topics: ["kitchen"], onMessage: (m) => seen.push(m) });
    handle.release();
    handle.update({ topics: ["orders"] });
    registry.deliver(event("tenant:t-1:kitchen"));
    registry.deliver(event("tenant:t-1:orders"));
    expect(seen).toEqual([]);
    expect(registry.union).toEqual([]);
  });
});

describe("readTabMessage", () => {
  it("admits the three verbs and refuses everything else", () => {
    expect(readTabMessage({ type: "alive" })).toEqual({ type: "alive" });
    expect(readTabMessage({ type: "bye" })).toEqual({ type: "bye" });
    expect(readTabMessage({ type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] })).toEqual({
      type: "subscribe",
      endpoint: "/api/r",
      topics: ["kitchen"],
    });
    expect(readTabMessage({ type: "subscribe", topics: [] })).toBeNull();
    expect(readTabMessage({ type: "subscribe", endpoint: "", topics: [] })).toBeNull();
    expect(readTabMessage({ type: "subscribe", endpoint: "/api/r", topics: [7] })).toBeNull();
    expect(readTabMessage({ type: "nope" })).toBeNull();
    expect(readTabMessage(null)).toBeNull();
  });
});

/** A hub, plus a record of every channel it built and every message it broadcast. */
function hubHarness() {
  const channels: { endpoint: string; topics: string[][]; closed: boolean; push: (m: RealtimeMessage) => void; setStatus: (s: "connected" | "disconnected") => void }[] = [];
  const hub = new WorkerHub((endpoint, handlers) => {
    const record = {
      endpoint,
      topics: [] as string[][],
      closed: false,
      push: (message: RealtimeMessage) => handlers.onMessage(message),
      setStatus: (status: "connected" | "disconnected") => handlers.onStatusChange(status),
    };
    channels.push(record);
    const channel: HubChannel = {
      setTopics: (topics) => record.topics.push([...topics]),
      close: () => {
        record.closed = true;
      },
    };
    return channel;
  });

  const tab = (): HubPort & { received: WorkerMessage[] } => {
    const received: WorkerMessage[] = [];
    return { received, postMessage: (message) => received.push(message) };
  };

  return { hub, channels, tab };
}

describe("WorkerHub — one connection per endpoint", () => {
  it("shares one channel across tabs on the same endpoint, and unions their topics", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    const second = tab();
    hub.connect(first, NOW_MS);
    hub.connect(second, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    hub.handle(second, { type: "subscribe", endpoint: "/api/r", topics: ["orders"] }, NOW_MS);

    expect(channels).toHaveLength(1);
    expect(channels[0]?.topics.at(-1)).toEqual(["kitchen", "orders"]);
  });

  it("never shares a channel between two DIFFERENT endpoints", () => {
    // The endpoint is what a subscription is authorized against: one ticket cannot be
    // minted for both, and the gateway is handed resolved names it may not mix.
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    const second = tab();
    hub.connect(first, NOW_MS);
    hub.connect(second, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/a", topics: ["kitchen"] }, NOW_MS);
    hub.handle(second, { type: "subscribe", endpoint: "/api/b", topics: ["kitchen"] }, NOW_MS);
    expect(channels.map((channel) => channel.endpoint)).toEqual(["/api/a", "/api/b"]);
  });

  it("gives a late tab the LIVE status, not the one it starts life believing", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    hub.connect(first, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    channels[0]?.setStatus("connected");

    const second = tab();
    hub.connect(second, NOW_MS);
    hub.handle(second, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    // Without this a tab opened second polls fast forever.
    expect(second.received[0]).toEqual({ type: "status", status: "connected" });
  });

  it("broadcasts an event to every tab of the group", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    const second = tab();
    hub.connect(first, NOW_MS);
    hub.connect(second, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    hub.handle(second, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    channels[0]?.push(event("tenant:t-1:kitchen"));
    expect(first.received.at(-1)).toMatchObject({ type: "event" });
    expect(second.received.at(-1)).toMatchObject({ type: "event" });
  });

  it("closes the channel when its last tab goes, and only then", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    const second = tab();
    hub.connect(first, NOW_MS);
    hub.connect(second, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    hub.handle(second, { type: "subscribe", endpoint: "/api/r", topics: ["orders"] }, NOW_MS);

    hub.handle(first, { type: "bye" }, NOW_MS);
    expect(channels[0]?.closed).toBe(false);
    expect(channels[0]?.topics.at(-1)).toEqual(["orders"]);

    hub.handle(second, { type: "bye" }, NOW_MS);
    expect(channels[0]?.closed).toBe(true);
    expect(hub.isIdle).toBe(true);
  });

  it("sweeps a tab that stopped answering — a crashed tab never says goodbye", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    hub.connect(first, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    // A SharedWorker is not told when a port goes away, so a dead tab's topics would hold
    // a subscription open forever.
    hub.sweep(NOW_MS + PORT_SILENCE_MS + 1);
    expect(channels[0]?.closed).toBe(true);
  });

  it("keeps a tab that is merely throttled", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    hub.connect(first, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    hub.handle(first, { type: "alive" }, NOW_MS + PORT_SILENCE_MS - 1);
    hub.sweep(NOW_MS + PORT_SILENCE_MS + 1);
    // Dropping a backgrounded kitchen tablet's topics mid-service is worse than holding
    // them a little longer than needed.
    expect(channels[0]?.closed).toBe(false);
  });

  it("moves a tab that switched endpoint, releasing the old group", () => {
    const { hub, channels, tab } = hubHarness();
    const first = tab();
    hub.connect(first, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/a", topics: ["kitchen"] }, NOW_MS);
    hub.handle(first, { type: "subscribe", endpoint: "/api/b", topics: ["kitchen"] }, NOW_MS);
    expect(channels[0]?.closed).toBe(true);
    expect(channels[1]?.endpoint).toBe("/api/b");
  });

  it("ignores a message from a port it never saw", () => {
    const { hub, channels, tab } = hubHarness();
    hub.handle(tab(), { type: "subscribe", endpoint: "/api/r", topics: ["kitchen"] }, NOW_MS);
    expect(channels).toEqual([]);
  });
});
