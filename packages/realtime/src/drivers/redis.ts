/**
 * The REDIS driver — the production path.
 *
 * Plain Redis pub/sub (`PUBLISH`/`SUBSCRIBE`), NOT streams, deliberately:
 * realtime events are hints to re-read, never the data itself (see the
 * payload rule on `RealtimeEvent`), so fire-and-forget fan-out is the right
 * durability level. A subscriber that was down missed the hint and recovers
 * through its polling fallback — nothing needs replay, so nothing needs a
 * stream, a consumer group, or retention tuning.
 *
 * Two connections, mirroring what Redis requires: a connection in subscriber
 * mode can issue no other command, so the driver keeps one PUBLISHER client
 * and one SUBSCRIBER client, each created lazily on first use — a process
 * that only publishes (the worker) never opens the subscriber connection.
 *
 * Every channel is prefixed `rt:`. The prefix is a CONSTANT, not a setting:
 * every stack runs its own `redis` container on its own compose network
 * (`REDIS_URL` is hardcoded to `redis://redis:6379`, not interpolated), so
 * there is no shared Redis to namespace apart — and the channel name is
 * internal to this driver either way.
 *
 * It was briefly configurable via `REALTIME_CHANNEL_PREFIX`, which was worse
 * than useless: only `apps/web` runs the Doppler entrypoint, so setting it
 * reached the publisher and NOT the gateway. The two halves would then use
 * different channels — sockets connect, the handshake passes, heartbeats run,
 * and no event is ever delivered, with no error on either side. A knob nobody
 * needs that can only be set wrongly is a trap, so it is gone.
 */

import { Redis } from "ioredis";

import type {
  RealtimeDriver,
  RealtimeEvent,
  RealtimeHandler,
  RealtimeLogger,
  Unsubscribe,
} from "../core/types";

/** The channel namespace. Internal — see the header for why it is not a setting. */
const CHANNEL_PREFIX = "rt";

/**
 * The slice of an ioredis client this driver uses — a seam so tests can
 * substitute an in-memory pair without a Redis server.
 */
export interface RedisPubSubClient {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: string, listener: (...args: never[]) => void): unknown;
  quit(): Promise<unknown>;
}

export interface RedisRealtimeDriverOptions {
  /** `redis://[user:pass@]host:port[/db]`. */
  redisUrl: string;
  logger: RealtimeLogger;
  /** Test seam: build the two clients from something other than ioredis. */
  createClient?: () => RedisPubSubClient;
}

/** Everything the driver's helpers need, threaded instead of closed over. */
interface DriverState {
  logger: RealtimeLogger;
  createClient: () => RedisPubSubClient;
  handlers: Map<string, Set<RealtimeHandler>>;
  /** Topics whose SUBSCRIBE the server has confirmed. */
  subscribedTopics: Set<string>;
  /** Per-topic SUBSCRIBE in flight — concurrent subscribers all await it. */
  subscribePending: Map<string, Promise<void>>;
  publisher: RedisPubSubClient | null;
  subscriber: RedisPubSubClient | null;
}

/** `topic` → Redis channel. */
function channelFor(topic: string): string {
  return `${CHANNEL_PREFIX}:${topic}`;
}

/**
 * Redis channel → `topic`, or `null` when the prefix does not match.
 *
 * Still checked rather than assumed: this driver's subscriber only ever
 * subscribes to its own channels, but a message arriving on anything else is
 * not ours to decode, and answering `null` is what keeps a foreign publisher
 * on the same Redis from being parsed as an event.
 */
function topicFor(channel: string): string | null {
  const lead = `${CHANNEL_PREFIX}:`;
  return channel.startsWith(lead) ? channel.slice(lead.length) : null;
}

/** Parse a wire message back into an envelope, or `null` when malformed. */
function decodeEvent(message: string): RealtimeEvent | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as RealtimeEvent).type === "string" &&
      typeof (parsed as RealtimeEvent).ts === "number" &&
      typeof (parsed as RealtimeEvent).id === "string"
    ) {
      return parsed as RealtimeEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fan one wire message out to the topic's local handlers. */
function dispatch(state: DriverState, channel: string, message: string): void {
  const topic = topicFor(channel);
  if (topic === null) return;
  const set = state.handlers.get(topic);
  if (!set) return;
  const event = decodeEvent(message);
  if (!event) {
    state.logger.error(`dropped a malformed message on "${channel}".`);
    return;
  }
  for (const handler of [...set]) {
    try {
      handler(topic, event);
    } catch (error) {
      state.logger.error(`subscriber for "${topic}" threw:`, error);
    }
  }
}

function getPublisher(state: DriverState): RedisPubSubClient {
  if (!state.publisher) {
    state.publisher = state.createClient();
    state.publisher.on("error", ((error: Error) =>
      state.logger.error("publisher connection error:", error)) as never);
  }
  return state.publisher;
}

function getSubscriber(state: DriverState): RedisPubSubClient {
  if (!state.subscriber) {
    state.subscriber = state.createClient();
    state.subscriber.on("error", ((error: Error) =>
      state.logger.error("subscriber connection error:", error)) as never);
    state.subscriber.on("message", ((channel: string, message: string) =>
      dispatch(state, channel, message)) as never);
  }
  return state.subscriber;
}

/** Drop one handler from the local registry (no Redis traffic). */
function removeHandler(
  state: DriverState,
  topic: string,
  handler: RealtimeHandler,
): void {
  const set = state.handlers.get(topic);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) state.handlers.delete(topic);
}

/** Detach one handler; the last one for a topic drops the channel entirely. */
async function detach(
  state: DriverState,
  topic: string,
  handler: RealtimeHandler,
): Promise<void> {
  const hadTopic = state.handlers.has(topic);
  removeHandler(state, topic, handler);
  if (hadTopic && !state.handlers.has(topic)) {
    state.subscribedTopics.delete(topic);
    await getSubscriber(state).unsubscribe(channelFor(topic));
  }
}

/**
 * Resolve once the topic's SUBSCRIBE is confirmed server-side. Concurrent
 * subscribers share the in-flight command instead of skipping it — so every
 * `attach` resolve really means "a publish issued after this line will be
 * observed". A rejected SUBSCRIBE clears the pending slot, so the next
 * subscriber retries the command rather than trusting a dead registration.
 */
function ensureSubscribed(state: DriverState, topic: string): Promise<void> {
  if (state.subscribedTopics.has(topic)) return Promise.resolve();
  let pending = state.subscribePending.get(topic);
  if (!pending) {
    pending = getSubscriber(state)
      .subscribe(channelFor(topic))
      .then(() => {
        state.subscribedTopics.add(topic);
      })
      .finally(() => {
        state.subscribePending.delete(topic);
      });
    state.subscribePending.set(topic, pending);
  }
  return pending;
}

async function attach(
  state: DriverState,
  topic: string,
  handler: RealtimeHandler,
): Promise<Unsubscribe> {
  let set = state.handlers.get(topic);
  if (!set) {
    set = new Set();
    state.handlers.set(topic, set);
  }
  set.add(handler);
  try {
    await ensureSubscribed(state, topic);
  } catch (error) {
    // Roll the registration back: a handler whose SUBSCRIBE never confirmed
    // must not linger, or every later subscriber to this topic would see it,
    // skip the SUBSCRIBE, and silently receive nothing.
    removeHandler(state, topic, handler);
    throw error;
  }
  return () => detach(state, topic, handler);
}

async function closeConnections(state: DriverState): Promise<void> {
  state.handlers.clear();
  state.subscribedTopics.clear();
  state.subscribePending.clear();
  const closing = [state.publisher, state.subscriber].filter(
    (client): client is RedisPubSubClient => client !== null,
  );
  state.publisher = null;
  state.subscriber = null;
  await Promise.all(
    closing.map((client) =>
      client.quit().catch((error) => state.logger.warn("close failed:", error)),
    ),
  );
}

export function createRedisRealtimeDriver(
  options: RedisRealtimeDriverOptions,
): RealtimeDriver {
  const state: DriverState = {
    logger: options.logger,
    createClient:
      options.createClient ??
      (() =>
        // `maxRetriesPerRequest: null` keeps ioredis retrying a dropped
        // connection forever instead of failing queued commands — a Redis
        // blip should cost missed events (the polling fallback's job), not a
        // crash.
        new Redis(options.redisUrl, { maxRetriesPerRequest: null })),
    handlers: new Map(),
    subscribedTopics: new Set(),
    subscribePending: new Map(),
    publisher: null,
    subscriber: null,
  };

  return {
    kind: "redis",

    async publish(topic: string, event: RealtimeEvent): Promise<void> {
      await getPublisher(state).publish(
        channelFor(topic),
        JSON.stringify(event),
      );
    },

    subscribe(topic: string, handler: RealtimeHandler): Promise<Unsubscribe> {
      return attach(state, topic, handler);
    },

    close(): Promise<void> {
      return closeConnections(state);
    },
  };
}

/**
 * Internals exposed for tests only — the channel codec must stay stable on
 * the wire, so it is pinned directly rather than inferred from a live Redis.
 */
export const __testables = { channelFor, topicFor, decodeEvent, CHANNEL_PREFIX };
