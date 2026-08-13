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
   * when configured, inline (loudly) when not.
   */
  driver?: RealtimeDriver;
  /**
   * Attach to a server the HOST owns instead of creating and listening on one.
   * The gateway then adds an `upgrade` listener and leaves the lifecycle alone —
   * `close()` will not stop a server it did not start.
   */
  server?: Server;
}

/** Which driver a standalone gateway runs. */
async function createDriver(
  config: GatewayConfig,
  logger: RealtimeLogger,
): Promise<RealtimeDriver> {
  if (!config.redisUrl) {
    // Inline delivery cannot cross a process boundary, so a publish from the API
    // process would never reach a socket held here. Useful only for a
    // single-process run (a test, the harness); loud so nobody mistakes it for a
    // working deployment.
    logger.warn(
      "REDIS_URL is unset — using the inline driver. Publishes from other processes will NOT arrive.",
    );
    return createInlineRealtimeDriver({ logger });
  }
  const { createRedisRealtimeDriver } = await import("../drivers/redis");
  return createRedisRealtimeDriver({ redisUrl: config.redisUrl, logger });
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
