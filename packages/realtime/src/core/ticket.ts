import { createHmac, timingSafeEqual } from "node:crypto";

import { isValidTopic } from "./topics";

/**
 * Connection tickets — the seam that lets a NON-Next process serve realtime
 * subscriptions without re-implementing a single line of authorization.
 *
 * ## Why a ticket at all
 *
 * The SSE endpoint is an ordinary route handler, so it authorizes a
 * subscription with the same session + RBAC code every other admin route uses.
 * A WebSocket cannot be served from a route handler (Next exposes no `upgrade`
 * hook, and `output: 'standalone'` rules out a custom server), so the socket is
 * served by a separate process — which has no NextAuth session, no Prisma and
 * no RBAC.
 *
 * Rather than teach that process to authorize (a second implementation of the
 * rules in `apps/web/lib/realtime/authorize.ts`, guaranteed to drift from the
 * first), the decision stays where it already lives:
 *
 *   1. The browser asks `apps/web` for a ticket. That request is a normal
 *      authenticated route — session, tenant resolution, per-topic RBAC, all
 *      unchanged.
 *   2. `apps/web` answers with the RESOLVED, fully-qualified topic names it
 *      just authorized, signed.
 *   3. The gateway verifies the signature and subscribes to exactly those
 *      names.
 *
 * The gateway therefore performs NO authorization and cannot be wrong about
 * it: a topic it was not handed is a topic it never subscribes to. The blast
 * radius of a gateway bug is "the socket does not work", never "the socket
 * shows somebody else's store".
 *
 * ## What the ticket is not
 *
 * It is not a session and must never be treated as one. It authorizes ONE
 * subscription to ONE fixed topic list for a few seconds, carries no identity
 * the gateway acts on, and grants nothing else anywhere in the system.
 */

/**
 * How long a minted ticket stays valid.
 *
 * Deliberately tiny: the only legitimate use is "open the socket I am about to
 * open", which follows the mint by one round trip. A longer window buys a
 * replay opportunity and no usability whatsoever — a client that took longer
 * than this to connect has a broken network and should mint again.
 */
export const TICKET_TTL_SECONDS = 30;

/** Guard against a pathological list smuggled past the caller's own cap. */
const MAX_TICKET_TOPICS = 16;

/** The signed body. Short keys: this travels in a query string. */
interface TicketPayload {
  /** Fully-qualified topic names, already authorized by the minting app. */
  t: string[];
  /** Expiry, epoch seconds. */
  e: number;
}

/** A verified ticket's contents. */
export interface RealtimeTicket {
  topics: string[];
  expiresAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Constant-time compare of two base64url signatures.
 *
 * Length is checked first and separately because `timingSafeEqual` THROWS on a
 * length mismatch rather than returning false — an attacker-controlled input
 * must never be able to turn a comparison into an exception.
 */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Mint a ticket for `topics`, which the caller has ALREADY authorized.
 *
 * `nowSeconds` is a parameter so the expiry is testable without faking the
 * clock globally.
 */
export function mintRealtimeTicket(
  topics: readonly string[],
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new Error("a realtime ticket secret is required");
  if (topics.length === 0 || topics.length > MAX_TICKET_TOPICS) {
    throw new Error("a realtime ticket must carry between 1 and 16 topics");
  }
  const payload: TicketPayload = {
    t: [...topics],
    e: nowSeconds + TICKET_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Split `<body>.<signature>`, or `null` when either half is missing. */
function splitTicket(ticket: string): { body: string; signature: string } | null {
  const separator = ticket.lastIndexOf(".");
  if (separator <= 0 || separator === ticket.length - 1) return null;
  return { body: ticket.slice(0, separator), signature: ticket.slice(separator + 1) };
}

/** Decode the signed body, or `null` for anything that is not an object. */
function decodePayload(body: string): TicketPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as TicketPayload;
  } catch {
    return null;
  }
}

/**
 * Is this payload one we can act on — shaped right, unexpired, and naming only
 * well-formed topics?
 *
 * The topic-shape check is belt-and-braces: the signature already proves the
 * minting app chose these names. It guards against a future minting bug
 * reaching the driver's channel names, which is the one place a malformed
 * topic could do something other than fail.
 */
function isUsablePayload(payload: TicketPayload, nowSeconds: number): boolean {
  if (!Array.isArray(payload.t) || typeof payload.e !== "number") return false;
  if (payload.e <= nowSeconds) return false;
  if (payload.t.length === 0 || payload.t.length > MAX_TICKET_TOPICS) return false;
  return payload.t.every((topic) => typeof topic === "string" && isValidTopic(topic));
}

/**
 * Verify a ticket and return its topics, or `null` for ANY problem —
 * malformed, bad signature, expired, or carrying a topic name that is not
 * well-formed.
 *
 * One return value for every failure mode on purpose: the caller is a socket
 * handshake with nothing useful to do differently, and distinguishing "bad
 * signature" from "expired" in a response only tells a prober which half to
 * work on.
 */
export function verifyRealtimeTicket(
  ticket: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RealtimeTicket | null {
  if (!secret || !ticket) return null;

  const parts = splitTicket(ticket);
  if (!parts) return null;
  if (!signaturesMatch(parts.signature, sign(parts.body, secret))) return null;

  const payload = decodePayload(parts.body);
  if (!payload || !isUsablePayload(payload, nowSeconds)) return null;

  return { topics: payload.t, expiresAt: payload.e };
}
