import { describe, expect, it, vi } from "vitest";

import type { RealtimeEvent } from "../../core/types";
import {
  __testables,
  createRedisRealtimeDriver,
  type RedisPubSubClient,
} from "../redis";

const { channelFor, topicFor, decodeEvent, CHANNEL_PREFIX } = __testables;

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * An in-memory stand-in for a Redis pub/sub pair: every client created from
 * one hub sees the publishes of every other, exactly like clients of one
 * Redis server. Lets the driver be exercised end-to-end without a container.
 */
interface Hub {
  clients: FakeClient[];
  createClient(): FakeClient;
}

class FakeClient implements RedisPubSubClient {
  readonly channels = new Set<string>();
  readonly listeners = new Map<string, Array<(...args: never[]) => void>>();
  quitCalls = 0;

  constructor(private readonly hub: Hub) {}

  publish(channel: string, message: string): Promise<number> {
    const delivery = { count: 0 };
    for (const client of this.hub.clients) {
      if (!client.channels.has(channel)) continue;
      for (const listener of client.listeners.get("message") ?? []) {
        (listener as (channel: string, message: string) => void)(channel, message);
        delivery.count += 1;
      }
    }
    return Promise.resolve(delivery.count);
  }

  subscribe(...channels: string[]): Promise<unknown> {
    for (const channel of channels) this.channels.add(channel);
    return Promise.resolve(channels.length);
  }

  unsubscribe(...channels: string[]): Promise<unknown> {
    for (const channel of channels) this.channels.delete(channel);
    return Promise.resolve(channels.length);
  }

  on(event: string, listener: (...args: never[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  quit(): Promise<unknown> {
    this.quitCalls += 1;
    return Promise.resolve("OK");
  }
}

function createHub(): Hub {
  const hub: Hub = {
    clients: [],
    createClient() {
      const client = new FakeClient(hub);
      hub.clients.push(client);
      return client;
    },
  };
  return hub;
}

/** A client whose first N SUBSCRIBE commands fail, then behave normally. */
class FlakySubscribeClient extends FakeClient {
  constructor(
    hub: Hub,
    private readonly failures: { remaining: number },
  ) {
    super(hub);
  }

  override subscribe(...channels: string[]): Promise<unknown> {
    if (this.failures.remaining > 0) {
      this.failures.remaining -= 1;
      return Promise.reject(new Error("SUBSCRIBE failed"));
    }
    return super.subscribe(...channels);
  }
}

function createFlakyHub(failures: { remaining: number }): Hub {
  const hub: Hub = {
    clients: [],
    createClient() {
      const client = new FlakySubscribeClient(hub, failures);
      hub.clients.push(client);
      return client;
    },
  };
  return hub;
}

/** A client that holds every SUBSCRIBE confirmation until released. */
class ManualSubscribeClient extends FakeClient {
  subscribeCalls = 0;
  private readonly held: Array<() => void> = [];

  override subscribe(...channels: string[]): Promise<unknown> {
    this.subscribeCalls += 1;
    return new Promise((resolve) => {
      this.held.push(() => {
        void super.subscribe(...channels).then(resolve);
      });
    });
  }

  releaseSubscribes(): void {
    for (const release of this.held.splice(0)) release();
  }
}

function createManualSubscribeHub(): Hub & { manualClients: ManualSubscribeClient[] } {
  const manualClients: ManualSubscribeClient[] = [];
  const hub: Hub & { manualClients: ManualSubscribeClient[] } = {
    clients: [],
    manualClients,
    createClient() {
      const client = new ManualSubscribeClient(hub);
      hub.clients.push(client);
      manualClients.push(client);
      return client;
    },
  };
  return hub;
}

/** Publish a raw wire message from a fresh client — malformed input on purpose. */
async function publishRaw(hub: Hub, channel: string, message: string): Promise<void> {
  await hub.createClient().publish(channel, message);
}

function driverOn(hub: Hub, options: { logger?: typeof silentLogger } = {}) {
  return createRedisRealtimeDriver({
    redisUrl: "redis://unused:6379",
    logger: options.logger ?? silentLogger,
    createClient: () => hub.createClient(),
  });
}

const event = (type: string): RealtimeEvent => ({ type, data: {}, ts: 1, id: "e1" });

describe("channel codec", () => {
  it("prefixes topics and round-trips them", () => {
    expect(channelFor("tenant:c1:kitchen")).toBe("rt:tenant:c1:kitchen");
    expect(topicFor("rt:tenant:c1:kitchen")).toBe("tenant:c1:kitchen");
    expect(CHANNEL_PREFIX).toBe("rt");
  });

  it("refuses a channel that is not ours", () => {
    // The prefix used to be configurable so two environments could share one
    // Redis. It is a constant now — every stack has its own redis container,
    // and the setting could only ever reach the publisher (see the driver's
    // header). This is what remains of that property and it is worth keeping:
    // a message on a foreign channel is not decoded as one of our events.
    expect(topicFor("other:tenant:c1:kitchen")).toBeNull();
    expect(topicFor("tenant:c1:kitchen")).toBeNull();
  });

  it("decodes only well-formed envelopes", () => {
    expect(decodeEvent(JSON.stringify(event("x")))).toEqual(event("x"));
    expect(decodeEvent("not json")).toBeNull();
    expect(decodeEvent(JSON.stringify({ type: 1 }))).toBeNull();
  });
});

describe("redis realtime driver", () => {
  it("delivers a publish to a subscriber across clients (separate processes)", async () => {
    const hub = createHub();
    const publisherSide = driverOn(hub);
    const subscriberSide = driverOn(hub);
    const received: { events: Array<[string, string]> } = { events: [] };

    await subscriberSide.subscribe("tenant:c1:kitchen", (topic, evt) => {
      received.events.push([topic, evt.type]);
    });
    await publisherSide.publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));

    expect(received.events).toEqual([["tenant:c1:kitchen", "kitchen.ticket.updated"]]);
  });

  it("unsubscribes the channel when the last local handler detaches", async () => {
    const hub = createHub();
    const driver = driverOn(hub);
    const first = await driver.subscribe("tenant:c1:kitchen", vi.fn());
    const second = await driver.subscribe("tenant:c1:kitchen", vi.fn());

    const subscriberClient = hub.clients.find((client) => client.channels.size > 0);
    expect(subscriberClient?.channels.has("rt:tenant:c1:kitchen")).toBe(true);

    await first();
    expect(subscriberClient?.channels.has("rt:tenant:c1:kitchen")).toBe(true);
    await second();
    expect(subscriberClient?.channels.has("rt:tenant:c1:kitchen")).toBe(false);
  });

  it("drops malformed wire messages with a log, never a throw", async () => {
    const hub = createHub();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const driver = driverOn(hub, { logger });
    const handler = vi.fn();
    await driver.subscribe("tenant:c1:kitchen", handler);

    await publishRaw(hub, "rt:tenant:c1:kitchen", "not json");

    expect(handler).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("rolls the handler back when SUBSCRIBE fails, so the next subscriber retries", async () => {
    const hub = createFlakyHub({ remaining: 1 });
    const driver = driverOn(hub);
    const rolledBack = vi.fn();
    const attached = vi.fn();

    await expect(driver.subscribe("tenant:c1:kitchen", rolledBack)).rejects.toThrow(
      "SUBSCRIBE failed",
    );

    // The failed handler must not linger as a phantom registration — the next
    // subscriber re-issues the SUBSCRIBE instead of skipping it, and only it
    // (never the rolled-back handler) receives events.
    await driver.subscribe("tenant:c1:kitchen", attached);
    await driverOn(hub).publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));

    expect(attached).toHaveBeenCalledTimes(1);
    expect(rolledBack).not.toHaveBeenCalled();
  });

  it("makes concurrent subscribers to one topic await the same in-flight SUBSCRIBE", async () => {
    const hub = createManualSubscribeHub();
    const driver = driverOn(hub);
    const first = vi.fn();
    const second = vi.fn();
    const settled = { first: false, second: false };

    const firstSubscribe = driver.subscribe("tenant:c1:kitchen", first);
    const secondSubscribe = driver.subscribe("tenant:c1:kitchen", second);
    void firstSubscribe.then(() => {
      settled.first = true;
    });
    void secondSubscribe.then(() => {
      settled.second = true;
    });

    // Neither subscriber resolves before the server confirms the SUBSCRIBE —
    // "resolves once the subscription is live" holds for the second one too.
    // (Microtask flushes, no timer: had either subscribe resolved, its
    // `.then` above would have run by now.)
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(settled).toEqual({ first: false, second: false });

    // One confirmation resolves both, and only one command was issued.
    hub.manualClients[0]?.releaseSubscribes();
    await Promise.all([firstSubscribe, secondSubscribe]);
    expect(hub.manualClients[0]?.subscribeCalls).toBe(1);

    await driverOn(hub).publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("close() quits both connections", async () => {
    const hub = createHub();
    const driver = driverOn(hub);
    await driver.subscribe("tenant:c1:kitchen", vi.fn());
    await driver.publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));

    await driver.close();

    expect(hub.clients).toHaveLength(2);
    expect(hub.clients.every((client) => client.quitCalls === 1)).toBe(true);
  });
});
