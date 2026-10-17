/**
 * `@12-apps/realtime` — typed topic-based pub/sub behind a swappable driver.
 *
 *     // at an emit site (a route, a BullMQ job handler — one call either way)
 *     await publishRealtimeEvent(tenantTopic(tenantId, "kitchen"), {
 *       type: "kitchen.ticket.updated",
 *       data: { ticketId },
 *     });
 *
 *     // at the host's subscribe endpoint, per client connection
 *     const unsubscribe = await subscribeRealtime(topic, (topic, event) => { … });
 *
 *     // at process start
 *     configureRealtime({ driver: createRedisRealtimeDriver({ redisUrl, logger }), logger });
 *
 * The rules that keep this safe are documented on `RealtimeEvent`: payloads
 * carry identifiers rather than state, and delivery is best-effort — every
 * consumer keeps a polling fallback, so a lost event costs latency, never
 * correctness.
 *
 * The Redis driver is deliberately NOT re-exported here — it is imported from
 * `@12-apps/realtime/redis`, so that pulling in `publishRealtimeEvent` at an emit
 * site never drags ioredis into a bundle that only ever publishes inline.
 */

export {
  tenantTopic,
  parseTenantTopic,
  userTopic,
  parseUserTopic,
  isValidTopic,
  InvalidTopicError,
} from "./core/topics";
export type { ParsedTenantTopic, ParsedUserTopic } from "./core/topics";

export {
  configureRealtime,
  getRealtimeDriver,
  publishRealtimeEvent,
  resetRealtimeRuntime,
  stopRealtime,
  subscribeRealtime,
} from "./core/runtime";

export type {
  PublishResult,
  PublishSkipReason,
  RealtimeDriver,
  RealtimeEvent,
  RealtimeEventInput,
  RealtimeHandler,
  RealtimeLogger,
  Unsubscribe,
} from "./core/types";

export { createInlineRealtimeDriver } from "./drivers/inline";
export type {
  InlinePublishRecord,
  InlineRealtimeDriver,
} from "./drivers/inline";

// Presence that lasts as long as a connection (`./core/presence.ts`): a surface's
// `authorize` names the keys, whichever process holds the socket announces them,
// and the API's `presence.onChange` hears every holder.
export {
  isValidPresenceKey,
  isValidPresenceList,
  MAX_PRESENCE_KEYS,
  PRESENCE_RENEW_MS,
  PRESENCE_TOPIC,
  PresenceTracker,
  presenceChangesOf,
  PRESENCE_EVENT_MAX_KEYS,
} from "./core/presence";
export type { PresenceChange, PresenceTrackerOptions } from "./core/presence";
export {
  PRESENCE_RELEASE_GRACE_MS,
  subscribePresence,
} from "./core/presence-listener";
export type { PresenceListenerOptions } from "./core/presence-listener";
