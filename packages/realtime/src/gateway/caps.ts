import { isValidTopic } from "../core/topics";
import type { RealtimeLogger } from "../core/types";

import type { GatewayConfig } from "./config";

/**
 * Per-class socket caps: a bound on how many of the gateway's
 * sockets one KIND of subscriber may hold, so a flood of one kind can never take the
 * slots another kind needs.
 *
 * ## Why the gateway needs it
 *
 * The only bound it had is {@link GatewayConfig.maxConnections}, one global count
 * checked at the upgrade before any ticket is read. That was enough while every
 * ticket was minted for a signed-in person: minting one costs a session. A host that
 * adds an ANONYMOUS surface — a TV showing a store's prices, minted for anybody who
 * asks — changes that. A per-requester rate limit at the minting side bounds one
 * requester, not a distributed flood, and a flood of valid anonymous tickets would
 * fill the global count and lock every staff screen out of its socket.
 *
 * ## Classified by topic, after the ticket is verified
 *
 * A ticket carries topics and deliberately no subject or surface (the gateway makes no
 * authorization decision), so the class is read off the TOPICS: a socket belongs to a
 * cap when EVERY topic of its ticket matches the cap's pattern. The anonymous surface's
 * tickets carry only its own topic, so they match; a staff ticket that also carried
 * that topic among others does not, and is never squeezed by the anonymous bound.
 *
 * Counted after verification, never before: an unverified upgrade holds no slot, and
 * counting it would let garbage tickets exhaust the very budget being protected.
 *
 * ## Patterns
 *
 * A topic is `:`-separated segments; `*` in a pattern matches exactly one segment.
 * `tenant:*:catalog` matches `tenant:c1:catalog` and not `tenant:c1:catalog:x` nor
 * `tenant:c1:orders`. Nothing else is special — a pattern is not a regular expression,
 * so a host cannot write one that matches more than it reads as.
 */

/** One class of sockets and how many of them a gateway process may hold. */
export interface TopicCap {
  /** `:`-separated segments; `*` matches exactly one segment. */
  pattern: string;
  /** Upper bound of simultaneous sockets in this class, per process. */
  maxConnections: number;
}

/**
 * Two things a class does NOT know, both by design:
 *
 *  - **who minted the ticket.** A staff screen whose ticket carries ONLY topics a cap
 *    matches is counted in that class. A host keeps its anonymous surface on a topic
 *    no staff screen subscribes to alone, so a pattern cannot catch a staff ticket.
 *  - **a later subscription.** The class is fixed at the handshake; a socket that
 *    widens or narrows its topics mid-connection keeps the slot it was admitted with.
 */

/** Whether `topic` matches `pattern`, segment by segment. */
export function topicMatches(pattern: string, topic: string): boolean {
  const want = pattern.split(":");
  const have = topic.split(":");
  if (want.length !== have.length) return false;
  return want.every((segment, index) => segment === "*" || segment === have[index]);
}

/**
 * The cap a ticket's topics fall under, or null. The FIRST cap every topic matches
 * wins, so a host lists its narrowest classes first. An empty topic list belongs to no
 * class — it subscribes to nothing, and a pattern cannot be vacuously true of it.
 */
export function capFor(
  caps: readonly TopicCap[] | undefined,
  topics: readonly string[],
): TopicCap | null {
  if (caps === undefined || topics.length === 0) return null;
  return caps.find((cap) => topics.every((topic) => topicMatches(cap.pattern, topic))) ?? null;
}

/**
 * Parse `REALTIME_GATEWAY_TOPIC_CAPS`: `pattern=max` pairs, comma-separated —
 * `tenant:*:catalog=500`. Throws on anything else, at start: a cap that silently failed
 * to parse is the unbounded gateway it was configured to prevent.
 */
export function parseTopicCaps(raw: string | undefined): TopicCap[] {
  const text = raw?.trim();
  if (!text) return [];
  const caps = text.split(",").map((entry) => {
    const match = /^\s*([^=\s]+)\s*=\s*(\d+)\s*$/.exec(entry);
    const max = match ? Number.parseInt(match[2] ?? "", 10) : Number.NaN;
    if (!match || !match[1] || !Number.isFinite(max) || max <= 0) {
      throw new Error(
        `REALTIME_GATEWAY_TOPIC_CAPS: "${entry.trim()}" is not "pattern=positive-integer"`,
      );
    }
    return { pattern: match[1], maxConnections: max };
  });
  return validateTopicCaps(caps);
}

/**
 * Refuse caps that cannot mean what they say, from the environment or from code alike:
 * a pattern that is not one, a bound that is not a positive integer, a pattern twice.
 */
export function validateTopicCaps(caps: readonly TopicCap[]): TopicCap[] {
  caps.forEach((cap) => {
    if (!isUsablePattern(cap.pattern)) {
      throw new Error(
        `REALTIME_GATEWAY_TOPIC_CAPS: "${cap.pattern}" is not a topic pattern (non-empty ` +
          "segments, at least one of them literal)",
      );
    }
    if (!Number.isInteger(cap.maxConnections) || cap.maxConnections <= 0) {
      throw new Error(`REALTIME_GATEWAY_TOPIC_CAPS: "${cap.pattern}" needs a positive bound`);
    }
  });
  const patterns = caps.map((cap) => cap.pattern);
  const duplicate = patterns.find((pattern, index) => patterns.indexOf(pattern) !== index);
  if (duplicate !== undefined) {
    throw new Error(`REALTIME_GATEWAY_TOPIC_CAPS: "${duplicate}" is listed twice`);
  }
  return [...caps];
}

/**
 * A pattern is a topic with `*` allowed for a segment — and at least one literal
 * segment, since `*:*:*` would class nearly every ticket of that length.
 */
function isUsablePattern(pattern: string): boolean {
  const segments = pattern.split(":");
  const literal = segments.filter((segment) => segment !== "*");
  return literal.length > 0 && literal.every((segment) => isValidTopic(segment));
}

/** Who holds a slot in which cap — admission and release, one place. */
export class CapLedger<Socket> {
  private readonly held = new Map<TopicCap, Set<Socket>>();

  /** Take a slot in `cap` for `socket`; false when the class is full. No class, always true. */
  admit(cap: TopicCap | null, socket: Socket): boolean {
    if (cap === null) return true;
    const sockets = this.held.get(cap) ?? new Set<Socket>();
    if (sockets.size >= cap.maxConnections) return false;
    sockets.add(socket);
    this.held.set(cap, sockets);
    return true;
  }

  /** Whether `cap` has a free slot right now. No class always has room. */
  hasRoom(cap: TopicCap | null): boolean {
    if (cap === null) return true;
    return (this.held.get(cap)?.size ?? 0) < cap.maxConnections;
  }

  /** Give back whatever slot `socket` held. Idempotent. */
  release(socket: Socket): void {
    for (const sockets of this.held.values()) sockets.delete(socket);
  }

  /** How many sockets hold a slot in `cap`. */
  count(cap: TopicCap): number {
    return this.held.get(cap)?.size ?? 0;
  }
}

/**
 * A class bound only protects the rest of the gateway when it leaves room: the global
 * count is checked before any ticket is read and counts class sockets too, so staff
 * headroom is `maxConnections − Σ caps`. Said at start, where an operator reads it.
 */
export function warnOnUnsafeCaps(
  config: Pick<GatewayConfig, "topicCaps" | "maxConnections">,
  logger: Pick<RealtimeLogger, "warn">,
): void {
  const total = (config.topicCaps ?? []).reduce((sum, cap) => sum + cap.maxConnections, 0);
  if (total > 0 && total >= config.maxConnections) {
    logger.warn(
      `REALTIME_GATEWAY_TOPIC_CAPS adds up to ${total}, at least the global ${config.maxConnections}: ` +
        "a flood of a capped class can still take every slot. Size the caps well below the global count.",
    );
  }
}
