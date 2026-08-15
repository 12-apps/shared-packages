import {
  MAX_TICKET_TOPICS,
  mintRealtimeTicket,
  TICKET_TTL_SECONDS,
} from "../core/ticket";
import {
  configureRealtime,
  getRealtimeDriver,
  stopRealtime,
} from "../core/runtime";
import type { RealtimeDriver, RealtimeLogger } from "../core/types";

import { ConnectionLedger } from "./connections";
import {
  createRealtimeOutbox,
  type RealtimeOutbox,
  type RealtimeOutboxOptions,
} from "./outbox";
import { DEFAULT_MAX_TOPICS_PER_CONNECTION, parseTopicList } from "./registry";
import { resolveRealtimeDriver } from "./resolve-driver";
import { createEventStreamResponse } from "./sse";
import { createTicketSecretResolver, type TicketSecretSource } from "./ticket-secret";
import {
  DEFAULT_EVENTS_MESSAGES,
  EventsDenial,
  isEventsDenial,
  type EventsAuthorization,
  type EventsMessages,
  type EventsRequestContext,
  type EventsRoute,
  type EventsRouteResult,
  type EventsSurfaceConfig,
  type EventsTopicSpec,
} from "./types";

/**
 * `createApiEvents` — the event system's API half as ONE mountable surface
 * (12-16). What used to be spread across the origin host's `apps/web/lib/realtime/`
 * and six route files: topic parsing, subscribe authorization, the SSE
 * transport, ticket minting for the WebSocket gateway, per-subject connection
 * bookkeeping, driver bootstrap and shutdown, and the transactional outbox.
 *
 * What stays the HOST's, and arrives as config rather than being guessed at:
 *
 *  - **Which domains exist** and on which surfaces — a surface's `domains`
 *    list plus its `path`.
 *  - **Who may watch what** — the `authorize` seam. The host resolves the
 *    subject (tenant from the path, user from the session, seat from a
 *    cookie), checks its own RBAC, and answers with the RESOLVED topic names.
 *    The package narrows nothing further: one refused topic must refuse the
 *    whole connection inside `authorize`, because a partial subscription
 *    would hide the denial from the client.
 *  - **Where the outbox rows live** — a structural db provider.
 *
 * ## The wire contract (unchanged from the origin host)
 *
 *  - `GET <surface.path>?topics=a,b` → SSE stream, or 400 (unknown topic),
 *    the authorize seam's own status (401/403/404), 503 (no driver — checked
 *    AFTER auth, so "realtime is off" is not information an unauthorized
 *    caller can collect), 429 (subject at its connection cap).
 *  - `POST <surface.path>/ticket?topics=a,b` → `{ data: { ticket,
 *    expiresInSeconds } }`, same authorization, 503 when no secret is
 *    configured. Denials are unwrapped (`{ error }`).
 */
export interface EventsServerConfig {
  /** The subscribe surfaces this host mounts. */
  surfaces: readonly EventsSurfaceConfig[];
  /**
   * An explicit driver (tests, embedded harnesses). When omitted, `start()`
   * resolves one from the environment — `REALTIME_DRIVER`, `REDIS_URL`,
   * `NODE_ENV` — exactly as the origin host's bootstrap did.
   */
  driver?: RealtimeDriver;
  logger?: RealtimeLogger;
  /**
   * The ticket-signing secret: a literal, a resolver, or (default) the env
   * fallback chain `REALTIME_TICKET_SECRET` → `AUTH_SECRET`.
   */
  ticketSecret?: TicketSecretSource;
  /**
   * Per-subject connection cap; default 20, env-overridable.
   *
   * **It covers the SSE path only, and SSE is not the wire a working deployment uses.**
   * `streamRoute` takes a ledger slot; `ticketRoute` cannot, because a ticket carries no
   * subject on purpose (`../core/ticket.ts` — the gateway must decide nothing), so the
   * gateway can only enforce its own GLOBAL `maxConnections`. The browser client starts on
   * `ws` and demotes to `sse` only on failure, so where the socket works this cap is never
   * reached: one authenticated subject capped at 20 SSE streams can still hold up to
   * `maxConnections` sockets on a gateway process. Making it real would mean an opaque
   * subject hash in the ticket and a per-subject ledger in the gateway — accounting, not
   * authorization — which is a deliberate non-goal here rather than an oversight.
   */
  connectionCap?: number;
  /**
   * Override the strings this surface puts on the wire. Defaults are today's pt-BR,
   * unchanged — see {@link EventsMessages}, which explains why they are the contract and
   * why they are nonetheless overridable.
   */
  messages?: Partial<EventsMessages>;
  /** Enable the transactional outbox by saying where its rows live. */
  outbox?: Omit<RealtimeOutboxOptions, "logger">;
  /**
   * Install SIGTERM/SIGINT hooks that end open streams cleanly on a deploy
   * (clients see EOF and reconnect to the new process). Default `true`;
   * a host embedding several factories or owning its own shutdown turns it
   * off and calls `closeAllStreams()` + `stop()` itself.
   */
  installSignalHooks?: boolean;
}

export interface EventsApi {
  /** Framework-neutral route descriptors: one stream + one ticket per surface. */
  routes: EventsRoute[];
  /**
   * Configure the driver for this process. Call once at process start; safe
   * to call again (no-op). Reads the environment at CALL time, not factory
   * time — same doctrine as `createApiJobs`.
   */
  start(): Promise<void>;
  /** End open streams, then release the driver's connections. */
  stop(): Promise<void>;
  /** End every open stream now (deploy path); streams' cleanups run once. */
  closeAllStreams(): void;
  /** The per-subject connection ledger, for tests and health readouts. */
  connections: ConnectionLedger;
  /** The outbox drain — present exactly when `config.outbox` was given. */
  outbox: RealtimeOutbox | null;
}

function denialResult(error: unknown): EventsRouteResult {
  if (isEventsDenial(error)) {
    return { status: error.status, body: { error: error.message } };
  }
  throw error;
}

/** Parse the surface's topic list out of the query, per its own rules. */
function specsFor(
  surface: EventsSurfaceConfig,
  query: Record<string, string | undefined>,
  messages: EventsMessages,
): EventsTopicSpec[] {
  if (surface.topicsQuery === false) return [];
  const raw = query.topics;
  if (!raw) throw new EventsDenial(400, messages.invalidTopics);
  return parseTopicList(
    raw,
    { domains: surface.domains, qualifiedDomains: surface.qualifiedDomains },
    surface.maxTopicsPerConnection ?? DEFAULT_MAX_TOPICS_PER_CONNECTION,
    messages,
  );
}

/**
 * Everything the two route builders need, resolved once per factory. Passed rather than
 * closed over so each builder is a module-scope function the size gate can measure on its
 * own — and so the surfaces cannot accidentally share mutable state.
 */
interface RouteDeps {
  logger: RealtimeLogger;
  connections: ConnectionLedger;
  ticketSecret: () => string | null;
  messages: EventsMessages;
}

/**
 * Authorize one request. EVERY topic is authorized before anything streams or is signed;
 * the seam throws `EventsDenial` for a refusal, and anything else is a host bug that
 * propagates as a 500 through the adapter.
 */
async function authorizeRequest(
  surface: EventsSurfaceConfig,
  context: EventsRequestContext,
  messages: EventsMessages,
): Promise<EventsAuthorization> {
  const specs = specsFor(surface, context.query, messages);
  return surface.authorize({ params: context.params, specs, request: context.request });
}

function streamRoute(surface: EventsSurfaceConfig, deps: RouteDeps): EventsRoute {
  return {
    method: "GET",
    path: surface.path,
    surface: surface.name,
    kind: "stream",
    handle: async (context): Promise<EventsRouteResult> => {
      let granted: EventsAuthorization;
      try {
        granted = await authorizeRequest(surface, context, deps.messages);
      } catch (error) {
        return denialResult(error);
      }

      // After auth, deliberately: "realtime is off" is not information an unauthorized
      // caller should be able to collect.
      if (!getRealtimeDriver()) return { status: 503, body: { error: deps.messages.unavailable } };

      // A stream subscribed to nothing is the LYING channel FUT-657 exists to prevent: it
      // opens, reports `connected`, heartbeats an empty topic list and the consumer
      // relaxes its poll on the strength of it. Refusing is the honest answer, and the
      // client's own heartbeat check would reach the same conclusion a beat later anyway.
      if (granted.topics.length === 0) {
        deps.logger.error(`surface "${surface.name}" authorized zero topics; refusing the stream.`);
        return { status: 503, body: { error: deps.messages.unavailable } };
      }

      const release = deps.connections.acquire(granted.subjectId);
      if (!release) {
        return {
          status: 429,
          body: { error: surface.tooManyMessage ?? deps.messages.tooMany },
        };
      }

      try {
        const response = await createEventStreamResponse({
          topics: granted.topics,
          onClose: release,
          streams: deps.connections,
        });
        return { response };
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}

function ticketRoute(surface: EventsSurfaceConfig, deps: RouteDeps): EventsRoute {
  return {
    // POST because it MINTS a credential: it must never be cached, prefetched or
    // replayed out of a browser history entry.
    method: "POST",
    path: `${surface.path}/ticket`,
    surface: surface.name,
    kind: "json",
    handle: async (context): Promise<EventsRouteResult> => {
      let granted: EventsAuthorization;
      try {
        // The identical authorization the stream route performs, so the two transports
        // can never disagree about who may watch what.
        granted = await authorizeRequest(surface, context, deps.messages);
      } catch (error) {
        return denialResult(error);
      }

      const secret = deps.ticketSecret();
      if (!secret) return { status: 503, body: { error: deps.messages.unavailable } };

      // A ticket travels in a query string, so the signed payload caps its topic list
      // (`MAX_TICKET_TOPICS`). `maxTopicsPerConnection` bounds the SPECS, not the resolved
      // names — a host whose `authorize` fans one spec out into several topics can exceed
      // it — and `mintRealtimeTicket` throws on that. Answered here rather than allowed to
      // become a 500 out of a crypto helper, and answered as `unavailable`: the honest
      // thing to tell a client is "no socket for you", which is exactly the state its SSE
      // fallback handles.
      if (granted.topics.length === 0 || granted.topics.length > MAX_TICKET_TOPICS) {
        deps.logger.error(
          `surface "${surface.name}" authorized ${granted.topics.length} topics; a ticket ` +
            `carries 1..${MAX_TICKET_TOPICS}. The WebSocket transport is unavailable for ` +
            `this connection; the client falls back to SSE.`,
        );
        return { status: 503, body: { error: deps.messages.unavailable } };
      }

      return {
        status: 200,
        body: {
          data: {
            ticket: mintRealtimeTicket(granted.topics, secret),
            expiresInSeconds: TICKET_TTL_SECONDS,
          },
        },
      };
    },
  };
}

/**
 * End open streams cleanly on a deploy: clients see EOF and reconnect to the new process;
 * the bus connections are released after.
 */
function installShutdownHooks(connections: ConnectionLedger, logger: RealtimeLogger): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      connections.closeAllStreams();
      void stopRealtime().catch((error) => logger.error("shutdown failed:", error));
    });
  }
}

export function createApiEvents(config: EventsServerConfig): EventsApi {
  const logger = config.logger ?? console;
  const connections = new ConnectionLedger({ logger, cap: config.connectionCap });
  const deps: RouteDeps = {
    logger,
    connections,
    ticketSecret: createTicketSecretResolver(config.ticketSecret, logger),
    // Resolved ONCE, and per field, so a host overriding one string keeps the defaults for
    // the other three rather than having to restate the wire contract to change a word.
    messages: { ...DEFAULT_EVENTS_MESSAGES, ...config.messages },
  };
  const outbox = config.outbox ? createRealtimeOutbox({ ...config.outbox, logger }) : null;
  const state = { started: false };

  return {
    routes: config.surfaces.flatMap((surface) => [
      streamRoute(surface, deps),
      ticketRoute(surface, deps),
    ]),
    connections,
    outbox,

    async start(): Promise<void> {
      if (state.started) return;
      state.started = true;

      const driver = config.driver ?? (await resolveRealtimeDriver(logger));
      if (!driver) return;
      configureRealtime({ driver, logger });

      if (config.installSignalHooks !== false) installShutdownHooks(connections, logger);
    },

    async stop(): Promise<void> {
      connections.closeAllStreams();
      await stopRealtime();
      state.started = false;
    },

    closeAllStreams(): void {
      connections.closeAllStreams();
    },
  };
}
