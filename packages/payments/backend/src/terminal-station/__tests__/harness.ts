import { randomBytes } from "node:crypto";

import WebSocket from "ws";

import { createLinkPeer, decodeBase64, macOf, type LinkPeer, type Message } from "../../terminal-link";
import type { TerminalEvent } from "../terminal-contract";
import { createTerminalLinkServer } from "../terminal-link";
import type { TerminalLinkDeps, TerminalLinkServer } from "../terminal-link-api";
import type { SecretSealer, StoredTerminalLink, TerminalLink } from "../terminal-link-cache";
import { wsListen } from "./ws-listeners";

/**
 * A REAL station server on 127.0.0.1, its listen port bound over `ws`, and a
 * REAL `ws` client playing the terminal. The terminal side speaks through
 * `../../terminal-link`, as a terminal app does.
 */

const secretOf = (): string => randomBytes(32).toString("base64");

export function link(deviceId: string, secret = secretOf()): TerminalLink {
  return { deviceId, provider: "PAGBANK", lanAddress: null, secret };
}

/**
 * A key store that seals by wrapping, and refuses what it did not seal —
 * asynchronous, as an operating system key store is. `reseal` makes
 * every open ask for the secret to be sealed again, as a rotated key does.
 */
export function fakeSealer(available = true, options: { reseal?: boolean } = {}): SecretSealer & { sealed: string[] } {
  const sealed: string[] = [];
  return {
    sealed,
    available: async () => available,
    seal: async (plain) => {
      const out = Buffer.from(`sealed:${plain}`).toString("base64");
      sealed.push(out);
      return out;
    },
    open: async (text) => {
      const plain = Buffer.from(text, "base64").toString("utf8");
      if (!plain.startsWith("sealed:")) throw new Error("not sealed here");
      return { plain: plain.slice("sealed:".length), reseal: options.reseal === true };
    },
  };
}

/** The settings file's kept links, in memory. */
export function memoryCache(initial: readonly StoredTerminalLink[] = []) {
  const disk = { links: initial };
  return { disk, read: () => disk.links, write: async (links: readonly StoredTerminalLink[]) => void (disk.links = links) };
}

export interface Station {
  readonly server: TerminalLinkServer;
  readonly url: string;
  readonly events: TerminalEvent[];
  /** Resolves with the first event that matches, past or future. */
  event(match: (event: TerminalEvent) => boolean): Promise<TerminalEvent>;
}

/** A started station whose links source answers `links`, listening on 127.0.0.1. */
export async function startStation(links: readonly TerminalLink[], overrides: Partial<TerminalLinkDeps> = {}): Promise<Station> {
  const events: TerminalEvent[] = [];
  const waiters: { match: (event: TerminalEvent) => boolean; resolve: (event: TerminalEvent) => void }[] = [];
  const server = createTerminalLinkServer({
    listen: wsListen,
    stationId: () => "station-1",
    source: async () => links,
    cache: memoryCache(),
    sealer: fakeSealer(),
    interfaces: () => ({}),
    hosts: ["127.0.0.1"],
    port: 0,
    pingIntervalMs: 60_000,
    ...overrides,
    onEvent: (event) => {
      events.push(event);
      for (const waiter of [...waiters]) {
        if (!waiter.match(event)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    },
  });
  await server.start();
  await server.refreshLinks();
  const [address] = server.addresses();
  return {
    server,
    url: `ws://${address}`,
    events,
    event: (match) => {
      const found = events.find(match);
      return found !== undefined ? Promise.resolve(found) : new Promise((resolve) => waiters.push({ match, resolve }));
    },
  };
}

export interface FakeTerminal {
  readonly socket: WebSocket;
  readonly peer: LinkPeer<"terminal">;
  /** Every raw frame the station sent. */
  readonly frames: string[];
  /** The next frame the station sends, opened and verified. */
  next(): Promise<Message<"station">>;
  /** Resolves when the station closes the connection. */
  readonly closed: Promise<{ code: number; reason: string }>;
  send(raw: string): void;
}

/** A terminal that connects; `hello` false sends nothing, so the test sends its own first frame. */
export async function connectTerminal(url: string, deviceId: string, secret: string, options: { hello?: boolean } = {}): Promise<FakeTerminal> {
  const key = decodeBase64(secret);
  if (key === null) throw new Error("bad secret");
  const peer = createLinkPeer("terminal", { key, identity: deviceId, nonce: () => randomBytes(16).toString("hex") });
  // eslint-disable-next-line test-flakiness/no-unmocked-network -- the point: a real client on 127.0.0.1 against the real server
  const socket = new WebSocket(url);
  const frames: string[] = [];
  const queue: string[] = [];
  const takers: ((raw: string) => void)[] = [];
  socket.on("message", (data) => {
    const raw = String(data);
    frames.push(raw);
    const taker = takers.shift();
    if (taker) taker(raw);
    else queue.push(raw);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const terminal: FakeTerminal = {
    socket,
    peer,
    frames,
    closed,
    send: (raw) => socket.send(raw),
    next: async () => {
      const raw = queue.shift() ?? (await new Promise<string>((resolve) => takers.push(resolve)));
      const opened = peer.open(raw);
      if (!opened.ok) throw new Error(`the station sent a frame the terminal refuses: ${opened.refusal}`);
      return opened.message;
    },
  };
  if (options.hello !== false) {
    socket.send(peer.hello());
    const answer = await terminal.next();
    if (answer.type !== "hello") throw new Error(`expected the station's hello, got ${answer.type}`);
  }
  return terminal;
}

/** Re-sign a frame after changing it, as a sender holding `secret` would. */
export function resign(raw: string, secret: string, change: (record: Record<string, unknown>) => void): string {
  const record = JSON.parse(raw) as Record<string, unknown>;
  change(record);
  return JSON.stringify({ ...record, mac: macOf(record, decodeBase64(secret)!) });
}
