import { WebSocketServer, type RawData, type WebSocket } from "ws";

import type { ListenPort, StationConnection, StationListeners } from "../terminal-link-api";

/**
 * The host's half of the listen port, over `ws`, as a host binds it: the
 * origin host's WebSocket servers, one per address, and the adapter from a
 * `ws` socket to a {@link StationConnection}. Here so the station core runs
 * against a REAL `ws` client in these tests.
 */

const textOf = (data: RawData): string => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString("utf8");

/** A `ws` socket as the station core sees it. */
function connectionOf(socket: WebSocket): StationConnection {
  return {
    isOpen: () => socket.readyState === socket.OPEN,
    send: (raw) => socket.send(raw),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    onMessage: (handler) => socket.on("message", (data, isBinary) => handler(isBinary ? "" : textOf(data), isBinary)),
    onClose: (handler) => socket.on("close", () => handler()),
    onError: (handler) => socket.on("error", handler),
  };
}

export const wsListen: ListenPort = (onConnection, log) => new WsListeners((socket) => onConnection(connectionOf(socket)), log);

/** A frame is a few hundred bytes; a typed-captures batch a few kilobytes. Larger is closed by `ws` (1009) before it is read. */
const MAX_FRAME_BYTES = 64 * 1024;

class WsListeners implements StationListeners {
  /** host → its server. */
  private readonly servers = new Map<string, WebSocketServer>();
  /** Hosts whose listen is in flight. */
  private readonly binding = new Set<string>();
  private stopped = false;

  constructor(
    private readonly onConnection: (socket: WebSocket) => void,
    private readonly log: (message: string) => void,
  ) {}

  /** Whether nothing listens and nothing is about to. */
  get idle(): boolean {
    return this.servers.size === 0 && this.binding.size === 0;
  }

  /** The hosts listened on now. */
  hosts(): string[] {
    return [...this.servers.keys()];
  }

  /** The `host:port` pairs actually listening. */
  addresses(): string[] {
    return [...this.servers.values()].flatMap((server) => {
      const address = server.address();
      return typeof address === "object" && address !== null ? [`${address.address}:${address.port}`] : [];
    });
  }

  /** Listen on every wanted host not yet listened on; close the servers of hosts that vanished. Answers whether one was added. */
  async sync(wanted: readonly string[], port: number): Promise<boolean> {
    if (this.stopped) return false;
    const keep = new Set(wanted);
    for (const [host, server] of [...this.servers]) {
      if (keep.has(host)) continue;
      this.servers.delete(host);
      this.log(`terminal-link: ${host} is gone; no longer listening on it`);
      // A session on a vanished address is dead: the heartbeat drops it.
      server.close();
    }
    const added = [...keep].filter((host) => !this.servers.has(host) && !this.binding.has(host));
    await Promise.all(added.map((host) => this.listen(host, port)));
    return added.length > 0;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const servers = [...this.servers.values()];
    this.servers.clear();
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }

  private listen(host: string, port: number): Promise<void> {
    this.binding.add(host);
    return new Promise((resolve) => {
      const listened = { settled: false };
      const server = new WebSocketServer({ host, port, maxPayload: MAX_FRAME_BYTES });
      // Persistent: an error after listening (or a second one) must not be an unhandled 'error' event.
      server.on("error", (error) => {
        this.log(`terminal-link: ${listened.settled ? "server error on" : "could not listen on"} ${host}:${port}: ${error.message}`);
        if (listened.settled) return;
        listened.settled = true;
        this.binding.delete(host);
        // A server whose listen failed holds nothing worth keeping: close it; the next sync tries again.
        server.close();
        resolve();
      });
      server.once("listening", () => {
        listened.settled = true;
        this.binding.delete(host);
        if (this.stopped) server.close();
        else this.servers.set(host, server);
        resolve();
      });
      server.on("connection", (socket) => this.onConnection(socket));
    });
  }
}
