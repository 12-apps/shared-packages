import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { configureRealtime, stopRealtime } from "../core/runtime";
import { TicketReplayGuard, verifyRealtimeTicket } from "../core/ticket";
import type { RealtimeDriver, RealtimeLogger } from "../core/types";
import { createInlineRealtimeDriver } from "../drivers/inline";

import { readGatewayConfig, type GatewayConfig, type GatewayConfigInput } from "./config";
import { attachConnection, type GatewaySocket } from "./connection";
import { MAX_INBOUND_BYTES } from "./inbound";

/**
 * `@12-apps/realtime/gateway` — the WebSocket gateway as a RUNNABLE ENTRY of the
 * package rather than a service a host copies (12-16).
 *
 * Two ways in, one implementation:
 *
 *     // programmatic — a host that owns its own process supervision
 *     const gateway = await startRealtimeGateway({ port: 3100 });
 *     await gateway.close();
 *
 *     # or the bin, for a container whose command is just "run the gateway"
 *     npx realtime-gateway
 *
 * ## Why a separate process at all
 *
 * It is a CHOICE now, not a constraint. future-pay's gateway docstring said "Next
 * cannot serve a WebSocket", which was true of route handlers and stopped being the
 * reason when that app moved to Hono — `serve()` returns a Node `http.Server` a
 * host could attach `ws` to directly. What survives is the actual benefit:
 * isolation (a socket flood cannot take the API down with it) and an independent
 * lifecycle (the API can deploy without dropping every socket, and vice versa).
 *
 * A host that would rather not run a second process can still use this: pass its
 * own `server`, and the gateway attaches to it instead of listening.
 *
 * ## It performs NO authorization, and that is the design
 *
 * This process has no session, no database and no RBAC. It never decides who may
 * watch what. The API surface makes that decision with the code it already has
 * (`createApiEvents`' `authorize` seam — domain tiers, station reach, open shift)
 * and signs the RESOLVED topic names into a short-lived ticket. The gateway
 * verifies the signature and subscribes to exactly those names.
 *
 * The consequence worth stating plainly: a bug in this file can break the socket,
 * but it cannot leak another tenant's events, because a topic that was never handed
 * over is a topic that is never subscribed to.
 *
 * ## `ws` is an OPTIONAL peer, so it is imported here and nowhere else
 *
 * A host that only wants `./server` or `./react` must never resolve it. Hence the
 * dynamic import below, and hence `./connection.ts` driving a structural
 * {@link GatewaySocket} rather than a `ws` type.
 */

/** The `ws` surface this module uses — resolved dynamically, typed structurally. */
interface WebSocketServerLike {
  handleUpgrade(
    request: IncomingMessage,
    socket: { destroy(): void; write(chunk: string): void },
    head: Buffer,
    callback: (ws: GatewaySocket) => void,
  ): void;
  close(): void;
}

interface WsModule {
  WebSocketServer: new (options: { noServer: true; maxPayload: number }) => WebSocketServerLike;
}

export interface RealtimeGateway {
  /** The resolved configuration, for logs and tests. */
  config: GatewayConfig;
  /** The HTTP server holding the upgrades — the host's if it passed one. */
  server: Server;
  /** How many sockets are open right now. */
  readonly connections: number;
  /** Close every socket, stop listening (unless the server was the host's), stop the bus. */
  close(): Promise<void>;
}

export interface StartGatewayOptions extends GatewayConfigInput {
  /**
   * An explicit driver. When omitted the gateway builds one from `redisUrl`: Redis
   * when configured, inline when inline was explicitly asked for, and otherwise it
   * REFUSES TO START — see {@link createDriver}.
   */
  driver?: RealtimeDriver;
  /**
   * Attach to a server the HOST owns instead of creating and listening on one.
   * The gateway then adds an `upgrade` listener and leaves the lifecycle alone —
   * `close()` will not stop a server it did not start.
   */
  server?: Server;
}

/**
 * Which driver a standalone gateway runs — and the one refusal in this file.
 *
 * ## An absent `REDIS_URL` is not consent, and a `warn` is not a guardrail
 *
 * Inline delivery cannot cross a process boundary, so a publish from the API process
 * never reaches a socket held here. What makes that worse than an outage is that
 * NOTHING FAILS, so every liveness mechanism in the package is defeated at once:
 * `/health` answers `{ok: true}` and the load balancer keeps the container in
 * rotation; the upgrade is accepted; `subscriptions.add(topic)` really succeeds, on a
 * bus with no publishers; the 25 s heartbeat carries the CORRECT, non-empty topic
 * list, so `heartbeatProvesBroken` is false and the silence watch is fed; the client
 * reports `connected` for ever and relaxes its poll from 5 s to 30 s; and because
 * `everConnected` is now true, the ws→sse demotion is disabled for the channel's life
 * — pinning every client to the dead wire while a working SSE endpoint sits beside it.
 * A screen six times staler than before realtime existed, announcing the opposite.
 * That is FUT-440/FUT-657 verbatim, and it is what the API half already refuses eighty
 * lines away (`../server/resolve-driver.ts`: inline is refused in production and
 * realtime is disabled instead).
 *
 * So inline needs an EXPLICIT opt-in (see {@link GatewayConfig.inlineConsent}), and
 * without one this throws. Failing to start is the gateway's established honest answer
 * for "I cannot do my job" — `resolveTicketSecret` already throws for a missing secret,
 * for the same reason: a gateway that starts and then refuses (or lies to) every socket
 * has no symptom anybody can act on.
 */
async function createDriver(
  config: GatewayConfig,
  logger: RealtimeLogger,
): Promise<RealtimeDriver> {
  if (config.redisUrl) {
    const { createRedisRealtimeDriver } = await import("../drivers/redis");
    return createRedisRealtimeDriver({ redisUrl: config.redisUrl, logger });
  }

  if (!config.inlineConsent) {
    throw new Error(
      "REDIS_URL is unset and the inline driver was not asked for. A gateway on the " +
        "inline driver accepts every socket, heartbeats the right topic names and " +
        "delivers nothing — so it is refused rather than started. Set REDIS_URL, or opt " +
        "in explicitly with REALTIME_DRIVER=inline (or redisUrl/driver/inlineConsent in " +
        "startRealtimeGateway's options).",
    );
  }

  // Asked for: a single-process run — a test, the harness, or a host embedding the
  // gateway on its own server. Still said out loud, because the one thing it cannot do
  // is the thing a reader assumes a gateway does.
  logger.warn(
    "running the INLINE driver by explicit request. Publishes from other processes will NOT arrive.",
  );
  return createInlineRealtimeDriver({ logger });
}

/** Health, for a compose healthcheck and a reverse proxy — the only HTTP this serves. */
function healthHandler(
  config: GatewayConfig,
  sockets: ReadonlySet<GatewaySocket>,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.url === config.healthPath) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, connections: sockets.size }));
      return;
    }
    // Everything else is somebody pointing the wrong thing at this port. The gateway
    // serves exactly one upgrade path and one health probe.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  };
}

/** Everything the upgrade handler needs. */
interface UpgradeDeps {
  config: GatewayConfig;
  sockets: Set<GatewaySocket>;
  replayGuard: TicketReplayGuard;
  wss: WebSocketServerLike;
  logger: RealtimeLogger;
}

/**
 * Verify the ticket and complete the handshake, or refuse at the HTTP layer.
 *
 * The refusal happens BEFORE the upgrade, so an unauthorized client never becomes a
 * socket at all — no bus subscription, no connection slot, nothing to clean up.
 */
function handleUpgrade(
  deps: UpgradeDeps,
  request: IncomingMessage,
  socket: { destroy(): void; write(chunk: string): void },
  head: Buffer,
): void {
  const { config, sockets, replayGuard, wss, logger } = deps;
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== config.socketPath) {
    socket.destroy();
    return;
  }

  if (sockets.size >= config.maxConnections) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }

  // The ticket travels in the query string because the browser's WebSocket constructor
  // cannot set headers — the one real constraint the client API imposes. It is safe here
  // BECAUSE the ticket is single-purpose, expires in seconds and is single-USE: it
  // authorizes one subscription to one fixed topic list and grants nothing else anywhere.
  const ticket = verifyRealtimeTicket(url.searchParams.get("ticket") ?? "", config.ticketSecret);
  // Burned on FIRST use, so a ticket captured out of a proxy log is worthless the moment
  // its owner connects — which, the mint being one round trip away from the handshake, is
  // immediately. A replay is refused with the SAME 401 as a bad signature: a prober
  // learns nothing from being told which half failed.
  if (!ticket || !replayGuard.consume(ticket)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    sockets.add(ws);
    void attachConnection({
      ws,
      topics: ticket.topics,
      onClose: () => sockets.delete(ws),
      ticketSecret: config.ticketSecret,
      replayGuard,
      logger,
    });
  });
}

/**
 * Start the gateway.
 *
 * Resolves once the socket is accepting upgrades — the returned handle is enough to
 * connect to and enough to shut down, so a caller never has to guess at readiness.
 */
export async function startRealtimeGateway(
  options: StartGatewayOptions = {},
): Promise<RealtimeGateway> {
  const logger = options.logger ?? console;
  const config = readGatewayConfig(options);
  const sockets = new Set<GatewaySocket>();
  // Per-process, and stated as such (see `TicketReplayGuard`): N instances grant N
  // uses of one ticket in the worst case. Sharing it would make the handshake
  // depend on Redis being reachable, which turns a hardening measure into an
  // outage path.
  const replayGuard = new TicketReplayGuard();

  configureRealtime({
    driver: options.driver ?? (await createDriver(config, logger)),
    logger,
  });

  const handleHttp = healthHandler(config, sockets);

  const ownsServer = options.server === undefined;
  const server = options.server ?? createServer(handleHttp);
  if (!ownsServer) server.on("request", handleHttp);

  const { WebSocketServer } = (await import("ws")) as unknown as WsModule;
  // `noServer` so the upgrade is handled explicitly: the ticket must be verified BEFORE
  // the handshake completes.
  //
  // `maxPayload` is the first line of the client→server defence: it is enforced by `ws`
  // before a frame is buffered, so an oversized push is refused without this process ever
  // allocating it. The check inside the handler is the second line, for anything that
  // arrives under the cap and is still nonsense.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_BYTES });

  server.on("upgrade", (request, socket, head) => {
    handleUpgrade({ config, sockets, replayGuard, wss, logger }, request, socket, head);
  });

  if (ownsServer) {
    await new Promise<void>((resolve) => {
      server.listen(config.port, () => resolve());
    });
    logger.info(
      `gateway listening on :${config.port}${config.socketPath} (max ${config.maxConnections} sockets)`,
    );
  }

  let closed = false;
  return {
    config,
    server,
    get connections(): number {
      return sockets.size;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Clients see a clean close and reconnect to whichever instance survives;
      // their polling fallback covers the gap either way.
      for (const ws of sockets) ws.close(1001, "server shutting down");
      sockets.clear();
      wss.close();
      if (ownsServer) await new Promise<void>((resolve) => server.close(() => resolve()));
      await stopRealtime();
    },
  };
}

/**
 * The bin's body: start, then wire SIGTERM/SIGINT to a clean shutdown.
 *
 * Separated from `startRealtimeGateway` because installing process-wide signal
 * handlers is right for a process whose whole job is the gateway and wrong for a
 * host embedding one — the same split `createApiEvents.installSignalHooks` makes.
 */
export async function runRealtimeGateway(
  options: StartGatewayOptions = {},
): Promise<RealtimeGateway> {
  const logger = options.logger ?? console;
  const gateway = await startRealtimeGateway(options);

  const shutdown = (signal: string): void => {
    logger.info(`${signal} — closing ${gateway.connections} socket(s)`);
    void gateway.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error("shutdown failed:", error);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return gateway;
}

/**
 * Internals this package's own suite drives directly.
 *
 * `createDriver` is here so the gateway's driver decision is testable at the SAME
 * granularity as the API half's (`resolveRealtimeDriver`, pinned by
 * `../server/__tests__/surface-internals.test.ts`) — no port, no socket, no `ws`.
 */
export const __testables = { createDriver };

export {
  readGatewayConfig,
  DEFAULT_GATEWAY_HEALTH_PATH,
  DEFAULT_GATEWAY_MAX_CONNECTIONS,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_GATEWAY_SOCKET_PATH,
  type GatewayConfig,
  type GatewayConfigInput,
} from "./config";
export {
  attachConnection,
  Subscriptions,
  type AttachConnectionOptions,
  type GatewaySocket,
} from "./connection";
export {
  INBOUND_BUCKET_CAPACITY,
  INBOUND_REFILL_PER_SECOND,
  InboundRateLimiter,
  MAX_INBOUND_BYTES,
  readInboundFrame,
  type InboundFrame,
  type InboundRejection,
} from "./inbound";
