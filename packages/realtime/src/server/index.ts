/**
 * `@12-apps/realtime/server` — the event system's API half (12-16).
 *
 * One factory, one config object:
 *
 *     const events = createApiEvents({
 *       surfaces: [{ name: "admin", path: "/admin/:tenantSlug/realtime", … }],
 *       outbox: { db: () => prisma },
 *     });
 *     await events.start();          // driver bootstrap, once per process
 *     app.route("/api", eventsRouter({ … }).router);   // @12-apps/realtime/hono
 *
 * What is INSIDE: topic registry and `?topics=` parsing, the subscribe
 * authorization seam, the SSE transport and its wire format, connection ticket
 * minting for the WebSocket gateway, per-subject connection bookkeeping, driver
 * resolution and shutdown, and the transactional outbox.
 *
 * What stays the HOST's: which domains exist on which path, who may watch what
 * (`authorize`, which resolves the subject and answers with RESOLVED topic
 * names), and where the outbox rows live.
 *
 * Framework-neutral by construction — a route is a descriptor, and `./hono` is
 * one adapter. The one twist realtime adds is that a stream handler may answer a
 * web-standard `Response`, which an adapter returns verbatim.
 */

export {
  createApiEvents,
  type EventsApi,
  type EventsServerConfig,
} from "./create-api-events";

export {
  ConnectionLedger,
  connectionCapFromEnv,
  DEFAULT_CONNECTION_CAP,
  type ConnectionLedgerOptions,
} from "./connections";

export {
  DEFAULT_MAX_TOPICS_PER_CONNECTION,
  parseTopicList,
  toTopicSpec,
  type TopicRegistry,
} from "./registry";

export { resolveRealtimeDriver } from "./resolve-driver";

export {
  createTicketSecretResolver,
  type TicketSecretSource,
} from "./ticket-secret";

export { createEventStreamResponse } from "./sse";

export {
  createRealtimeOutbox,
  enqueueRealtimeEvent,
  OUTBOX_DEFAULT_BATCH_SIZE,
  OUTBOX_DEFAULT_CLAIM_LEASE_MS,
  OUTBOX_DEFAULT_MAX_ATTEMPTS,
  type OutboxDrainResult,
  type RealtimeOutbox,
  type RealtimeOutboxDrainDb,
  type RealtimeOutboxInput,
  type RealtimeOutboxOptions,
  type RealtimeOutboxRow,
  type RealtimeOutboxWriteDb,
} from "./outbox";

export {
  EventsDenial,
  isEventsDenial,
  type EventsAuthorization,
  type EventsAuthorizeContext,
  type EventsMessages,
  type EventsRequestContext,
  type EventsRoute,
  type EventsRouteResult,
  type EventsSurfaceConfig,
  type EventsTopicSpec,
} from "./types";
export { PT_BR_EVENTS_MESSAGES } from "./pt-BR";
export { EN_US_EVENTS_MESSAGES } from "./en-US";
export { EVENTS_MESSAGES } from "./locales";
