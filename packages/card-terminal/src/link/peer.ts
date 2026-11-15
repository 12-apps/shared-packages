import { utf8 } from "./encoding";
import { hmacSha256, toHex } from "./hmac-sha256";
import {
  LINK_PROTOCOL_VERSION,
  readMessage,
  type BodyFrom,
  type LinkRefusal,
  type LinkSide,
  type Message,
  type StationHello,
  type TerminalHello,
} from "./messages";

/**
 * One end of one LAN session: it seals what this side
 * sends and opens what the other side sent, refusing a forged, stale or
 * replayed frame.
 *
 * **The handshake.** The terminal speaks first: `hello {deviceId, nonce}`. The
 * station finds that device's link secret, checks the mac, and answers `hello
 * {stationId, nonce, reply}`, where `reply` echoes the terminal's nonce and its
 * own `nonce` becomes the session id. From then on every message in both
 * directions carries that `sid`.
 *
 * **Why a session id and not only the counter.** A counter that only grows
 * stops a replay within one connection. Across connections each side would
 * have to remember the other's last counter for good, which a phone reinstall
 * or a wiped station would lose. Binding every message to the station's fresh
 * nonce makes a frame from an earlier connection fail the `session` check; the
 * echoed nonce makes an old station hello fail at the terminal. An old terminal
 * hello is the one frame a fresh session cannot bind: the station refuses it by
 * its clock (`at`) and by remembering the nonces it accepted while they are
 * fresh (`createNonceMemory`).
 */

/** HMAC-SHA256: the JavaScript one by default; the station may hand `node:crypto`'s. */
export type MacFunction = (key: Uint8Array, message: Uint8Array) => Uint8Array;

/** A message's frame clock may differ from ours by this much and still be fresh. */
export const DEFAULT_MAX_SKEW_MS = 5 * 60_000;

/** JSON with every object's keys sorted, no whitespace: what the mac covers. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The mac of a message: every key but `mac`, canonical, under `key`. */
export function macOf(message: Readonly<Record<string, unknown>>, key: Uint8Array, mac: MacFunction = hmacSha256): string {
  const signed = Object.fromEntries(Object.entries(message).filter(([name]) => name !== "mac"));
  return toHex(mac(key, utf8(canonicalJson(signed))));
}

/** Equal in time that does not depend on where they differ. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether `message`'s mac is the one `key` gives. */
export function macMatches(message: Readonly<Record<string, unknown>> & { readonly mac: string }, key: Uint8Array, mac: MacFunction = hmacSha256): boolean {
  return sameHex(macOf(message, key, mac), message.mac);
}

export interface PeerOptions {
  /** The link's secret, decoded. */
  readonly key: Uint8Array;
  /** This side's id: the station's id, or the terminal's device id. */
  readonly identity: string;
  /** A fresh random nonce, 32 to 64 lowercase hex characters. */
  readonly nonce: () => string;
  readonly mac?: MacFunction;
  readonly now?: () => number;
  readonly maxSkewMs?: number;
}

export type OpenResult<S extends LinkSide> =
  | { readonly ok: true; readonly message: Message<S> }
  | { readonly ok: false; readonly refusal: LinkRefusal; readonly detail?: string };

/** The bodies this side sends once the session is open (its hello is {@link LinkPeer.hello}). */
type SessionBody<S extends LinkSide> = Exclude<BodyFrom<S>, { type: "hello" }>;

export interface LinkPeer<Self extends LinkSide> {
  /**
   * This side's hello. The terminal sends it first; the station only after it
   * accepted the terminal's (it echoes that nonce, and opens the session).
   */
  hello(): string;
  /** Seal a message for the open session. Throws before the session is open. */
  seal(body: SessionBody<Self>): string;
  /** Read, verify and account one frame from the other side. */
  open(raw: string): OpenResult<Other<Self>>;
  /** Verify and account a frame already read (the station reads the first hello to find the key). */
  accept(message: Message<Other<Self>>): OpenResult<Other<Self>>;
  /** The open session's id; null before the handshake. */
  readonly sid: string | null;
}

export type Other<S extends LinkSide> = S extends "station" ? "terminal" : "station";

/** One end of a session, as `side`. */
export function createLinkPeer<Self extends LinkSide>(side: Self, options: PeerOptions): LinkPeer<Self> {
  const mac = options.mac ?? hmacSha256;
  const now = options.now ?? Date.now;
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  const from = (side === "station" ? "terminal" : "station") as Other<Self>;
  let sent = 0;
  let received = 0;
  let sid: string | null = null;
  /** The terminal's own hello nonce, which the station must echo. */
  let ownNonce: string | null = null;
  /** The terminal's nonce, which the station's hello echoes. */
  let peerNonce: string | null = null;

  const stamp = (body: Readonly<Record<string, unknown>>): string => {
    sent += 1;
    const unsigned = { ...body, v: LINK_PROTOCOL_VERSION, n: sent, at: now() };
    return JSON.stringify({ ...unsigned, mac: macOf(unsigned, options.key, mac) });
  };

  const refuse = (refusal: LinkRefusal, detail?: string): OpenResult<Other<Self>> => ({ ok: false, refusal, ...(detail === undefined ? {} : { detail }) });

  const accept = (message: Message<Other<Self>>): OpenResult<Other<Self>> => {
    const record = message as unknown as Record<string, unknown> & { mac: string };
    if (!macMatches(record, options.key, mac)) return refuse("bad-mac");
    if (Math.abs(now() - message.at) > maxSkewMs) return refuse("stale");
    if (message.n <= received) return refuse("replayed", `n=${message.n} after ${received}`);
    const problem = message.type === "hello" ? acceptHello(message as unknown as StationHello | TerminalHello) : sid !== null && message.sid === sid ? null : "session";
    if (problem !== null) return refuse("session", problem === "session" ? undefined : problem);
    received = message.n;
    return { ok: true, message };
  };

  /** The other side's hello: the first frame only; the station's must echo our nonce. Answers why not, or null. */
  const acceptHello = (hello: StationHello | TerminalHello): string | null => {
    if (received !== 0) return "second hello";
    if (side === "station") {
      peerNonce = (hello as TerminalHello).nonce;
      return null;
    }
    const answer = hello as StationHello;
    if (ownNonce === null || answer.reply !== ownNonce) return "hello does not answer ours";
    sid = answer.nonce;
    return null;
  };

  return {
    get sid() {
      return sid;
    },
    hello() {
      if (sent !== 0) throw new Error("terminal-link: hello is the first frame of a session");
      if (side === "terminal") {
        ownNonce = options.nonce();
        return stamp({ type: "hello", deviceId: options.identity, nonce: ownNonce });
      }
      if (peerNonce === null) throw new Error("terminal-link: the station answers the terminal's hello");
      sid = options.nonce();
      return stamp({ type: "hello", stationId: options.identity, nonce: sid, reply: peerNonce });
    },
    seal(body) {
      if (sid === null) throw new Error("terminal-link: no session yet");
      return stamp({ ...body, sid });
    },
    open(raw) {
      const read = readMessage(raw, from);
      if (!read.ok) return read;
      return accept(read.message);
    },
    accept,
  };
}

/**
 * The hello nonces a station accepted while they are fresh: an old terminal
 * hello, replayed inside the clock window, is refused by its nonce.
 */
export function createNonceMemory(options: { readonly now?: () => number; readonly ttlMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 2 * DEFAULT_MAX_SKEW_MS;
  const seen = new Map<string, number>();
  return {
    /** `true` the first time a nonce is offered within the window; `false` for a replay. */
    remember(nonce: string): boolean {
      const at = now();
      for (const [key, expires] of seen) if (expires <= at) seen.delete(key);
      if (seen.has(nonce)) return false;
      seen.set(nonce, at + ttlMs);
      return true;
    },
  };
}
