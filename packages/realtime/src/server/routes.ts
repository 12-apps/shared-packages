import { isValidPresenceList } from "../core/presence-keys";
import type { PresenceTracker } from "../core/presence";
import { getRealtimeDriver } from "../core/runtime";
import { MAX_TICKET_TOPICS, mintRealtimeTicket, TICKET_TTL_SECONDS } from "../core/ticket";
import type { RealtimeLogger } from "../core/types";

import type { ConnectionLedger } from "./connections";
import { DEFAULT_MAX_TOPICS_PER_CONNECTION, parseTopicList } from "./registry";
import { createEventStreamResponse } from "./sse";
import {
  EventsDenial,
  isEventsDenial,
  resolveEventsCopy,
  type EventsAuthorization,
  type EventsCopySource,
  type EventsMessages,
  type EventsRequestContext,
  type EventsRoute,
  type EventsRouteResult,
  type EventsSurfaceConfig,
  type EventsTopicSpec,
} from "./types";

/**
 * The two routes every surface contributes — the SSE stream and the ticket mint —
 * split out of `./create-api-events.ts` so the factory reads as what it is: config in,
 * descriptors and a lifecycle out. Both run the surface's `authorize` and nothing
 * else decides who may watch what; the two cannot disagree because they share it.
 */

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
export interface RouteDeps {
  logger: RealtimeLogger;
  connections: ConnectionLedger;
  ticketSecret: () => string | null;
  /**
   * The SOURCE, unresolved. Holding a value here is what would re-freeze the
   * language into the factory — `deps` is built once, per process.
   */
  messages: EventsCopySource<EventsMessages>;
  /** What this process's SSE streams hold (`../core/presence.ts`). */
  presence: PresenceTracker;
  /** How long a presence-holding stream lives before it rotates (`./sse.ts`). */
  presenceStreamMaxAgeMs: number;
}

/**
 * A grant the transports cannot honour — a host bug, answered as `unavailable`
 * rather than as a 500 out of a crypto helper, for the reason the ticket route gives.
 */
function invalidPresence(
  surface: EventsSurfaceConfig,
  granted: EventsAuthorization,
  logger: RealtimeLogger,
): boolean {
  if (granted.presence === undefined || isValidPresenceList(granted.presence)) return false;
  logger.error(
    `surface "${surface.name}" authorized malformed presence keys; refusing the connection.`,
  );
  return true;
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

/** A grant no stream may serve — a host bug, logged, answered as `unavailable`. */
function unstreamable(
  surface: EventsSurfaceConfig,
  granted: EventsAuthorization,
  logger: RealtimeLogger,
): boolean {
  // A stream subscribed to nothing is the LYING channel FUT-657 exists to prevent: it
  // opens, reports `connected`, heartbeats an empty topic list and the consumer
  // relaxes its poll on the strength of it. Refusing is the honest answer.
  if (granted.topics.length === 0) {
    logger.error(`surface "${surface.name}" authorized zero topics; refusing the stream.`);
    return true;
  }
  // The ticket refuses a reserved `$…` name at the mint; a stream has no ticket, so
  // it refuses here — a host bug must not hand a browser the presence bus.
  if (granted.topics.some((topic) => topic.startsWith("$"))) {
    logger.error(`surface "${surface.name}" authorized a reserved topic; refusing the stream.`);
    return true;
  }
  return invalidPresence(surface, granted, logger);
}

export function streamRoute(surface: EventsSurfaceConfig, deps: RouteDeps): EventsRoute {
  return {
    method: "GET",
    path: surface.path,
    surface: surface.name,
    kind: "stream",
    handle: async (context): Promise<EventsRouteResult> => {
      // Resolved here, per request, from the tag the adapter put on the
      // context — never in the factory, which ran once at boot.
      const messages = resolveEventsCopy(deps.messages, context.locale);
      let granted: EventsAuthorization;
      try {
        granted = await authorizeRequest(surface, context, messages);
      } catch (error) {
        return denialResult(error);
      }

      // After auth, deliberately: "realtime is off" is not information an unauthorized
      // caller should be able to collect.
      if (!getRealtimeDriver()) return { status: 503, body: { error: messages.unavailable } };

      if (unstreamable(surface, granted, deps.logger)) {
        return { status: 503, body: { error: messages.unavailable } };
      }

      const releaseSlot = deps.connections.acquire(granted.subjectId);
      if (!releaseSlot) {
        return {
          status: 429,
          body: { error: surface.tooManyMessage ?? messages.tooMany },
        };
      }
      // Held for exactly the stream's life: the stream's single-shot cleanup runs
      // `onClose` on every exit path (client gone, shutdown, a write that finds the
      // client gone), so presence cannot outlive the connection that holds it.
      const held = granted.presence ?? [];
      const releasePresence = deps.presence.hold(held);
      const release = (): void => {
        releaseSlot();
        releasePresence();
      };

      try {
        const response = await createEventStreamResponse({
          topics: granted.topics,
          onClose: release,
          streams: deps.connections,
          ...(held.length > 0 ? { maxAgeMs: deps.presenceStreamMaxAgeMs } : {}),
        });
        return { response };
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}

export function ticketRoute(surface: EventsSurfaceConfig, deps: RouteDeps): EventsRoute {
  return {
    // POST because it MINTS a credential: it must never be cached, prefetched or
    // replayed out of a browser history entry.
    method: "POST",
    path: `${surface.path}/ticket`,
    surface: surface.name,
    kind: "json",
    handle: async (context): Promise<EventsRouteResult> => {
      // Per request, exactly as the stream route does: the two transports must
      // not disagree about the language any more than about the authorization.
      const messages = resolveEventsCopy(deps.messages, context.locale);
      let granted: EventsAuthorization;
      try {
        // The identical authorization the stream route performs, so the two transports
        // can never disagree about who may watch what.
        granted = await authorizeRequest(surface, context, messages);
      } catch (error) {
        return denialResult(error);
      }

      const secret = deps.ticketSecret();
      if (!secret) return { status: 503, body: { error: messages.unavailable } };

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
        return { status: 503, body: { error: messages.unavailable } };
      }
      if (invalidPresence(surface, granted, deps.logger)) {
        return { status: 503, body: { error: messages.unavailable } };
      }

      return {
        status: 200,
        body: {
          data: {
            // The keys travel signed beside the topics; the gateway holds them for
            // the socket's life and decides nothing about whose they are.
            ticket: mintRealtimeTicket(granted.topics, secret, undefined, {
              presence: granted.presence ?? [],
            }),
            expiresInSeconds: TICKET_TTL_SECONDS,
          },
        },
      };
    },
  };
}
