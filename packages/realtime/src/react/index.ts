/**
 * `@12-apps/realtime/react` — the event system's browser half (12-16).
 *
 * One factory: {@link createWebEvents}. Everything else exported here is either a seam
 * a consumer legitimately needs (the two `refetchInterval` helpers, the standalone
 * `useRealtime`) or an internal a host may want to drive directly (the channel, the
 * registry).
 *
 * The contract every consumer is held to, in two lines:
 *
 *   - **Keep your poll.** Realtime only RELAXES it (`reconcileRefetchInterval`); it never
 *     replaces it. A lost event must cost latency, never correctness.
 *   - **Events carry no state.** Every message is `{ topic, type, data: {}, ts, id }` — a
 *     hint to re-read. The endpoint that already decides what this caller may see stays
 *     the only authority; a payload here would be a second, unguarded copy of an
 *     authorization decision.
 */

export {
  createWebEvents,
  type EventsProviderProps,
  type UseTopicsOptions,
  type UseTopicsResult,
  type WebEvents,
  type WebEventsConfig,
} from "./create-web-events";

export {
  fallbackRefetchInterval,
  reconcileRefetchInterval,
  useRealtime,
  type UseRealtimeOptions,
  type UseRealtimeResult,
} from "./use-realtime";

export {
  RealtimeChannel,
  type OutboundFrame,
  type RealtimeChannelOptions,
} from "./connection";

export {
  createLocalHost,
  createSharedWorkerHost,
  sharedWorkerConnector,
  type ChannelHost,
  type LocalHostOptions,
  type WorkerConnector,
} from "./channel-host";

export {
  MAX_TOPICS_PER_TICKET,
  SharedRealtimeChannel,
  type SharedRealtimeChannelOptions,
} from "./shared-channel";

export {
  mergeTopics,
  sameTopics,
  SubscriptionRegistry,
  topicServes,
  type Subscription,
  type SubscriptionHandle,
} from "./subscription-registry";

export {
  CONTROL_TOPIC,
  heartbeatProvesBroken,
  readHeartbeat,
  readServedTopics,
  SILENCE_CHECK_MS,
  SILENCE_LIMIT_MS,
  SilenceWatch,
} from "./liveness";

export {
  createWebSocketSource,
  defaultSocketUrl,
  fetchRealtimeTicket,
  mintTicketFor,
  socketUrlWithTicket,
  ticketUrlFor,
} from "./ws-source";

export type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransport,
  RealtimeTransportConfig,
  WireSource,
  WireSourceFactory,
} from "./types";
