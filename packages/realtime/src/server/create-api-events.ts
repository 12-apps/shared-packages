import {
  PresenceTracker,
  subscribePresence,
  type PresenceChange,
} from "../core/presence";
import { configureRealtime, stopRealtime } from "../core/runtime";
import type { RealtimeDriver, RealtimeLogger, Unsubscribe } from "../core/types";

import { ConnectionLedger } from "./connections";
import {
  createRealtimeOutbox,
  type RealtimeOutbox,
  type RealtimeOutboxOptions,
} from "./outbox";
import { resolveRealtimeDriver } from "./resolve-driver";
import { streamRoute, ticketRoute, type RouteDeps } from "./routes";
import { createTicketSecretResolver, type TicketSecretSource } from "./ticket-secret";
import type {
  EventsCopySource,
  EventsMessages,
  EventsRoute,
  EventsSurfaceConfig,
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
   * The strings this surface puts on the wire — REQUIRED, the host's words
   * (see {@link EventsMessages}). A pt-BR host passes `PT_BR_EVENTS_MESSAGES`
   * from `./pt-BR`, which is the exact set the origin host's SPAs already
   * read; requiring it is what turns that choice into a line in the host's
   * diff instead of a silence.
   *
   * A bilingual host passes a RESOLVER instead — `localeCopy(EVENTS_MESSAGES)`
   * — and each request is then answered in its own caller's language. The
   * plain value stays legal, so a host with one audience changes nothing.
   */
  messages: EventsCopySource<EventsMessages>;
  /** Enable the transactional outbox by saying where its rows live. */
  outbox?: Omit<RealtimeOutboxOptions, "logger">;
  /**
   * Install SIGTERM/SIGINT hooks that end open streams cleanly on a deploy
   * (clients see EOF and reconnect to the new process). Default `true`;
   * a host embedding several factories or owning its own shutdown turns it
   * off and calls `closeAllStreams()` + `stop()` itself.
   */
  installSignalHooks?: boolean;
  /**
   * Hear presence changes (`../core/presence.ts`): a key a surface's `authorize`
   * handed a connection is `held` while any connection holding it is open —
   * announced on open and renewed from the server while it stays open — and
   * `released` when the last one closes. Every holder reports here, the gateway
   * processes and this process's own SSE streams alike, through the bus.
   *
   * Give it in every API process that should WRITE presence; leave it out where
   * none should (the listener is the only thing it turns on — connections hold
   * their keys either way). Handlers must be idempotent: a renewal repeats a
   * `held`, and every listening process hears every change.
   */
  presence?: {
    onChange: (change: PresenceChange) => void | Promise<void>;
    /** Renewal cadence for THIS process's SSE streams; default `PRESENCE_RENEW_MS`. */
    renewMs?: number;
  };
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
  /** The presence keys this process's streams hold — for tests and health readouts. */
  presence: PresenceTracker;
}

/**
 * End open streams cleanly on a deploy: clients see EOF and reconnect to the new process;
 * the bus connections are released after.
 */
function installShutdownHooks(
  connections: ConnectionLedger,
  presence: PresenceTracker,
  logger: RealtimeLogger,
): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      connections.closeAllStreams();
      // The streams' own releases have already been sent; this waits for them,
      // so a deploy tells every host the people it dropped instead of leaving
      // them to lapse at the end of their lease.
      void presence
        .releaseAll()
        .then(() => stopRealtime())
        .catch((error) => logger.error("shutdown failed:", error));
    });
  }
}

/**
 * Install the host's presence listener once the driver is up — and only where the
 * host asked for one. Answered with its unsubscribe, or `null`.
 */
async function listenForPresence(
  config: EventsServerConfig,
  logger: RealtimeLogger,
): Promise<Unsubscribe | null> {
  if (!config.presence) return null;
  try {
    return await subscribePresence(config.presence.onChange, logger);
  } catch (error) {
    // Never fatal: presence is a latency optimisation like every hint, and a
    // listener that could not subscribe leaves the host on its own lease.
    logger.error("could not listen for presence changes:", error);
    return null;
  }
}

export function createApiEvents(config: EventsServerConfig): EventsApi {
  const logger = config.logger ?? console;
  const connections = new ConnectionLedger({ logger, cap: config.connectionCap });
  const presence = new PresenceTracker({ renewMs: config.presence?.renewMs, logger });
  const deps: RouteDeps = {
    logger,
    connections,
    ticketSecret: createTicketSecretResolver(config.ticketSecret, logger),
    // Carried unresolved. Each handler resolves against its own request's
    // locale, which is the whole reason the field takes a resolver at all.
    messages: config.messages,
    presence,
  };
  const outbox = config.outbox ? createRealtimeOutbox({ ...config.outbox, logger }) : null;
  const state: { started: boolean; unlisten: Unsubscribe | null } = {
    started: false,
    unlisten: null,
  };

  return {
    routes: config.surfaces.flatMap((surface) => [
      streamRoute(surface, deps),
      ticketRoute(surface, deps),
    ]),
    connections,
    outbox,
    presence,

    async start(): Promise<void> {
      if (state.started) return;
      state.started = true;

      const driver = config.driver ?? (await resolveRealtimeDriver(logger));
      if (!driver) return;
      configureRealtime({ driver, logger });
      state.unlisten = await listenForPresence(config, logger);

      if (config.installSignalHooks !== false) installShutdownHooks(connections, presence, logger);
    },

    async stop(): Promise<void> {
      connections.closeAllStreams();
      // Released and PUBLISHED before the bus goes, for the gateway's reason.
      await presence.releaseAll();
      await state.unlisten?.().catch(() => undefined);
      state.unlisten = null;
      await stopRealtime();
      state.started = false;
    },

    closeAllStreams(): void {
      connections.closeAllStreams();
    },
  };
}
