import { verifyRealtimeTicket, type RealtimeTicket } from "../core/ticket";

/**
 * The client→server half of the socket channel — parsing and admission, with no
 * socket and no bus in sight so the rules are testable on their own. Ported from
 * future-pay's `apps/realtime-gateway/src/inbound.ts` (FUT-644).
 *
 * ## Why a closed verb set and not a general RPC
 *
 * Everything a client needs to say here is about ITS OWN subscription: widen it,
 * narrow it, or prove it is still there. Nothing else belongs on this wire —
 * mutations are HTTP requests through the API that already authorizes them, and
 * adding a second, socket-shaped way to change data would put a write path in a
 * process that deliberately has no session, no database and no RBAC.
 *
 * So the verbs are fixed, exhaustively typed, and anything else is refused
 * without interpretation. A frame this module does not recognise is never "close
 * enough".
 *
 * ## Why `subscribe` needs a ticket and `unsubscribe` does not
 *
 * The asymmetry is the whole security model, not an oversight. Widening what a
 * socket receives is an authorization decision, and this process makes none — the
 * API surface decides with the RBAC it already has and signs the RESOLVED topic
 * names. So a `subscribe` carries a fresh ticket and the gateway subscribes to
 * exactly what is inside it, exactly as it does at handshake time.
 *
 * Narrowing needs no permission: a client that stops listening to a topic it was
 * already authorized for cannot learn anything by doing so. Requiring a ticket to
 * unsubscribe would only mean a client that cannot mint one has to stay
 * subscribed, which is worse for everyone.
 */

/** The one shape a client may push, after validation. */
export type InboundFrame =
  /** Widen the subscription to the topics inside a freshly signed ticket. */
  | { kind: "subscribe"; topics: readonly string[]; ticket: RealtimeTicket }
  /** Narrow it. Names not currently held are ignored, not an error. */
  | { kind: "unsubscribe"; topics: readonly string[] }
  /** "Still here" — presence, and a client-driven liveness signal. */
  | { kind: "ping" };

/** Why a frame was refused. The client sees this; it never sees an exception. */
export type InboundRejection =
  | "malformed"
  | "unknown-verb"
  | "bad-ticket"
  | "replayed-ticket"
  | "too-many-topics"
  | "rate-limited";

/**
 * Not exported: `readInboundFrame`'s return type is reachable by inference, and
 * nothing outside this module names it. It becomes part of the surface the day
 * something needs to hold one.
 */
type InboundResult =
  | { ok: true; frame: InboundFrame }
  | { ok: false; reason: InboundRejection };

/**
 * Upper bound on `unsubscribe` names in one frame.
 *
 * `subscribe` needs no equivalent because its list comes from a ticket, which
 * carries its own cap (`MAX_TICKET_TOPICS`) and is signed — a client cannot
 * inflate it. `unsubscribe` is unsigned by design (see the module docstring), so
 * this is the bound that keeps an unsigned list from being a cheap way to make
 * the gateway do work.
 */
const MAX_UNSUBSCRIBE_TOPICS = 32;

const MALFORMED: InboundResult = { ok: false, reason: "malformed" };

/** A `subscribe`: the topics come from the ticket, never from the frame. */
function readSubscribe(body: Record<string, unknown>, ticketSecret: string): InboundResult {
  if (typeof body.ticket !== "string") return MALFORMED;
  // The SAME verification the handshake performs, deliberately — one
  // implementation of "is this client allowed these topics", so a widening
  // mid-connection can never be laxer than the one that opened it.
  const ticket = verifyRealtimeTicket(body.ticket, ticketSecret);
  if (!ticket) return { ok: false, reason: "bad-ticket" };
  return { ok: true, frame: { kind: "subscribe", topics: ticket.topics, ticket } };
}

/** An `unsubscribe`: unsigned, therefore bounded here. */
function readUnsubscribe(body: Record<string, unknown>): InboundResult {
  if (!Array.isArray(body.topics)) return MALFORMED;
  if (body.topics.length > MAX_UNSUBSCRIBE_TOPICS) {
    return { ok: false, reason: "too-many-topics" };
  }
  if (!body.topics.every((topic): topic is string => typeof topic === "string")) return MALFORMED;
  return { ok: true, frame: { kind: "unsubscribe", topics: body.topics } };
}

/**
 * Parse and admit one raw message.
 *
 * `ticketSecret` is passed rather than read from config so the rules stay pure;
 * the caller owns configuration.
 */
export function readInboundFrame(raw: string, ticketSecret: string): InboundResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return MALFORMED;
  }
  if (parsed === null || typeof parsed !== "object") return MALFORMED;
  const body = parsed as Record<string, unknown>;

  switch (body.type) {
    case "ping":
      return { ok: true, frame: { kind: "ping" } };
    case "subscribe":
      return readSubscribe(body, ticketSecret);
    case "unsubscribe":
      return readUnsubscribe(body);
    default:
      // A non-string `type` lands here too, and "malformed" is the honest answer
      // for it — there was no verb to fail to recognise.
      return typeof body.type === "string" ? { ok: false, reason: "unknown-verb" } : MALFORMED;
  }
}

/**
 * Per-connection admission rate, as a token bucket.
 *
 * A socket is a standing invitation to spend the server's time, and unlike an
 * HTTP route there is no per-request layer in front of it to say no. One
 * misbehaving client — a reconnect loop that resubscribes on every render, a
 * script — could otherwise keep this process busy for everyone on it.
 *
 * Refill is computed from elapsed time rather than driven by a timer: a bucket per
 * connection would mean thousands of timers, and the arithmetic is exact either
 * way.
 */
export class InboundRateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = nowMs;
  }

  /** Spend one token. `false` means the caller should refuse the frame. */
  take(nowMs: number): boolean {
    const elapsedSeconds = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    this.lastRefillMs = nowMs;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Bucket size and refill for one socket.
 *
 * Sized for the traffic the protocol actually has: a burst on mount (one
 * subscribe, maybe an unsubscribe of the previous route's topics) and a ping every
 * heartbeat after that. A client doing anything legitimate never approaches this;
 * a client that does is not doing anything legitimate.
 */
export const INBOUND_BUCKET_CAPACITY = 20;
export const INBOUND_REFILL_PER_SECOND = 1;

/** The largest raw message accepted, before parsing. */
export const MAX_INBOUND_BYTES = 8 * 1024;

export const __testables = { MAX_UNSUBSCRIBE_TOPICS };
