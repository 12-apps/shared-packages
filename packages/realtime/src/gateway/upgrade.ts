import type { IncomingMessage } from "node:http";

import type { PresenceTracker } from "../core/presence";
import { verifyRealtimeTicket, type TicketReplayGuard } from "../core/ticket";
import type { RealtimeLogger } from "../core/types";

import { capFor, type CapLedger } from "./caps";
import type { GatewayConfig } from "./config";
import { attachConnection, type GatewaySocket } from "./connection";

/**
 * The upgrade path: verify the ticket, admit the socket, hand it to `./connection.ts`.
 * Split out of `./index.ts` so the entry stays what it reads as — start, serve health,
 * close — and this file holds every check a socket passes before it exists.
 */

/** The `ws` surface this module uses — resolved dynamically, typed structurally. */
export interface WebSocketServerLike {
  handleUpgrade(
    request: IncomingMessage,
    socket: { destroy(): void; write(chunk: string): void },
    head: Buffer,
    callback: (ws: GatewaySocket) => void,
  ): void;
  close(): void;
}

/** Everything the upgrade handler needs. */
interface UpgradeDeps {
  config: GatewayConfig;
  sockets: Set<GatewaySocket>;
  replayGuard: TicketReplayGuard;
  wss: WebSocketServerLike;
  logger: RealtimeLogger;
  caps: CapLedger<GatewaySocket>;
  /**
   * The presence keys this process's sockets hold. A socket holds what its
   * HANDSHAKE ticket names, from the moment it is admitted until it closes —
   * the gateway decides nothing about who that is, exactly as for topics.
   */
  presence: PresenceTracker;
}

/** Answer an upgrade at the HTTP layer and drop it — it never becomes a socket. */
function refuse(socket: { destroy(): void; write(chunk: string): void }, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

/**
 * Verify the ticket and complete the handshake, or refuse at the HTTP layer.
 *
 * The refusal happens BEFORE the upgrade, so an unauthorized client never becomes a
 * socket at all — no bus subscription, no connection slot, nothing to clean up.
 */
export function handleUpgrade(
  deps: UpgradeDeps,
  request: IncomingMessage,
  socket: { destroy(): void; write(chunk: string): void },
  head: Buffer,
): void {
  const { config, sockets, replayGuard, wss, logger, caps, presence } = deps;
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== config.socketPath) {
    socket.destroy();
    return;
  }

  if (sockets.size >= config.maxConnections) return refuse(socket, "503 Service Unavailable");

  // The ticket travels in the query string because the browser's WebSocket constructor
  // cannot set headers — the one real constraint the client API imposes. It is safe here
  // BECAUSE the ticket is single-purpose, expires in seconds and is single-USE: it
  // authorizes one subscription to one fixed topic list and grants nothing else anywhere.
  const ticket = verifyRealtimeTicket(url.searchParams.get("ticket") ?? "", config.ticketSecret);
  // Burned on FIRST use, so a ticket captured out of a proxy log is worthless the moment
  // its owner connects — which, the mint being one round trip away from the handshake, is
  // immediately. A replay is refused with the SAME 401 as a bad signature: a prober
  // learns nothing from being told which half failed.
  if (!ticket) return refuse(socket, "401 Unauthorized");

  // The class bound (see `./caps.ts`), checked only once the signature is real (an
  // unverified upgrade must never count against the budget it is there to protect) and
  // BEFORE the ticket is burned, so a refusal for capacity leaves it usable exactly
  // like the global 503 above does. The same 503 — the client backs off either way.
  const cap = capFor(config.topicCaps, ticket.topics);
  if (!caps.hasRoom(cap)) return refuse(socket, "503 Service Unavailable");

  if (!replayGuard.consume(ticket)) return refuse(socket, "401 Unauthorized");

  wss.handleUpgrade(request, socket, head, (ws) => {
    // Admitted here, defensively: `ws` calls back synchronously today, but should the
    // handshake ever become asynchronous two upgrades could pass `hasRoom` for the last
    // slot. The loser is closed with 1013 (try again later) and holds nothing.
    if (!caps.admit(cap, ws)) {
      ws.close(1013, "class at capacity");
      return;
    }
    sockets.add(ws);
    // Held from admission, released by the same single-shot cleanup that frees
    // the slot — so a socket that dies without a close frame (the liveness
    // sweep in `./connection.ts` terminates it) releases its presence too.
    const releasePresence = presence.hold(ticket.presence);
    void attachConnection({
      ws,
      topics: ticket.topics,
      onClose: () => {
        sockets.delete(ws);
        caps.release(ws);
        releasePresence();
      },
      ticketSecret: config.ticketSecret,
      replayGuard,
      logger,
    });
  });
}
