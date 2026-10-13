/**
 * Per-class socket caps (future-pay FUT-3554): a bound on how many of the gateway's
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

/** Whether `topic` matches `pattern`, segment by segment. */
export function topicMatches(pattern: string, topic: string): boolean {
  const want = pattern.split(":");
  const have = topic.split(":");
  if (want.length !== have.length) return false;
  return want.every(
    (segment, index) => segment === "*" || segment === have[index],
  );
}

/**
 * The cap a ticket's topics fall under, or null. The FIRST cap every topic matches
 * wins, so a host lists its narrowest classes first. An empty topic list belongs to no
 * class — it subscribes to nothing, and a pattern cannot be vacuously true of it.
 */
export function capFor(
  caps: readonly TopicCap[],
  topics: readonly string[],
): TopicCap | null {
  if (topics.length === 0) return null;
  return (
    caps.find((cap) =>
      topics.every((topic) => topicMatches(cap.pattern, topic)),
    ) ?? null
  );
}

/**
 * Parse `REALTIME_GATEWAY_TOPIC_CAPS`: `pattern=max` pairs, comma-separated —
 * `tenant:*:catalog=500`. Throws on anything else, at start: a cap that silently failed
 * to parse is the unbounded gateway it was configured to prevent.
 */
export function parseTopicCaps(raw: string | undefined): TopicCap[] {
  const text = raw?.trim();
  if (!text) return [];
  return text.split(",").map((entry) => {
    const match = /^\s*([^=\s]+)\s*=\s*(\d+)\s*$/.exec(entry);
    const max = match ? Number.parseInt(match[2] ?? "", 10) : Number.NaN;
    if (!match || !match[1] || !Number.isFinite(max) || max <= 0) {
      throw new Error(
        `REALTIME_GATEWAY_TOPIC_CAPS: "${entry.trim()}" is not "pattern=positive-integer"`,
      );
    }
    return { pattern: match[1], maxConnections: max };
  });
}

/** Who holds a slot in which cap — admission and release, one place. */
export class CapLedger<Socket> {
  private readonly held = new Map<TopicCap, Set<Socket>>();

  /** Take a slot in `cap` for `socket`; false when the class is full. */
  admit(cap: TopicCap, socket: Socket): boolean {
    const sockets = this.held.get(cap) ?? new Set<Socket>();
    if (sockets.size >= cap.maxConnections) return false;
    sockets.add(socket);
    this.held.set(cap, sockets);
    return true;
  }

  /** Whether `cap` has a free slot right now. */
  hasRoom(cap: TopicCap): boolean {
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
