import { createHmac, randomBytes } from "node:crypto";

import {
  createLinkPeer,
  decodeBase64,
  readMessage,
  type createNonceMemory,
  type LinkPeer,
  type MacFunction,
  type Message,
  type TerminalHello,
} from "../terminal-link";

import { CLOSE } from "./terminal-link-api";
import type { TerminalLink } from "./terminal-link-cache";

/**
 * The station's reading of a terminal's first frame: its
 * signed `hello`, or why the connection closes. `./terminal-link.ts` admits
 * what this accepts.
 */

/** `node:crypto`'s HMAC for the station: the same bytes as the package's JavaScript one. */
const nodeMac: MacFunction = (key, message) => new Uint8Array(createHmac("sha256", key).update(message).digest());
const freshNonce = (): string => randomBytes(16).toString("hex");

interface HelloContext {
  readonly links: readonly TerminalLink[];
  /** This computer's station id; null before the host assigns one. */
  readonly stationId: string | null;
  readonly nonces: ReturnType<typeof createNonceMemory>;
  readonly now: () => number;
}

type HelloResult =
  | { readonly ok: true; readonly deviceId: string; readonly secret: string; readonly peer: LinkPeer<"station"> }
  /** `log`: what the station's log says (absent for a frame that is not a hello at all). */
  | { readonly ok: false; readonly code: number; readonly reason: string; readonly log?: string };

const refuse = (code: number, reason: string, log?: string): HelloResult => ({ ok: false, code, reason, ...(log === undefined ? {} : { log }) });

/**
 * The first frame read as the terminal's hello. Each refusal names itself
 * apart — an unknown device, a computer with no station id yet, a link secret
 * that is not base64, a hello the protocol refuses (mac, clock, replay) — so
 * the log says which.
 */
export function readHello(raw: string, context: HelloContext): HelloResult {
  const read = readMessage(raw, "terminal");
  if (!read.ok || read.message.type !== "hello") return refuse(CLOSE.malformed, read.ok ? "hello first" : read.refusal);
  const hello = read.message as Message<"terminal"> & TerminalHello;
  const link = context.links.find((candidate) => candidate.deviceId === hello.deviceId);
  if (link === undefined) return refuse(CLOSE.unknownDevice, "unknown device", `${hello.deviceId}: unknown device`);
  if (context.stationId === null) return refuse(CLOSE.noStation, "no station id", `${hello.deviceId}: this computer has no station id yet`);
  const key = decodeBase64(link.secret);
  if (key === null) return refuse(CLOSE.unknownDevice, "bad link secret", `${hello.deviceId}: its link secret is not base64`);
  const peer = createLinkPeer("station", { key, identity: context.stationId, nonce: freshNonce, mac: nodeMac, now: context.now });
  const accepted = peer.accept(hello);
  const refusal = !accepted.ok ? accepted.refusal : context.nonces.remember(hello.nonce) ? null : "replayed";
  if (refusal !== null) return refuse(CLOSE.refused, refusal, `the hello of ${hello.deviceId}: ${refusal}`);
  return { ok: true, deviceId: hello.deviceId, secret: link.secret, peer };
}
