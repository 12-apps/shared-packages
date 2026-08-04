/**
 * Topic naming — the one convention every publisher and subscriber shares.
 *
 * A topic is a colon-separated path. The canonical tenant-scoped form is:
 *
 *     tenant:<clientId>:<domain>[:<qualifier>...]
 *
 * e.g. `tenant:ck2x…:kitchen`, `tenant:ck2x…:orders`. The tenant id comes
 * FIRST so authorization can be decided from the topic name alone — the host's
 * subscribe endpoint derives "which tenant, which domain" without consulting
 * the publisher, and a subscriber can never smuggle a foreign tenant into a
 * qualifier segment (segments are validated to contain no `:`).
 */

/** Leading marker of every tenant-scoped topic. */
const TENANT_PREFIX = "tenant";

/** One topic path segment: non-empty, no separator, no whitespace. */
const SEGMENT_RE = /^[^\s:]+$/;

/** Thrown for a malformed segment — always a programming error at the call site. */
export class InvalidTopicError extends Error {
  constructor(segment: string) {
    super(`Invalid topic segment: ${JSON.stringify(segment)}`);
    this.name = "InvalidTopicError";
  }
}

function assertSegment(segment: string): void {
  if (!SEGMENT_RE.test(segment)) throw new InvalidTopicError(segment);
}

/**
 * Build the canonical tenant-scoped topic: `tenant:<tenantId>:<domain>[:…]`.
 * Throws {@link InvalidTopicError} on an empty or separator-carrying segment.
 */
export function tenantTopic(
  tenantId: string,
  domain: string,
  ...qualifiers: string[]
): string {
  const segments = [tenantId, domain, ...qualifiers];
  for (const segment of segments) assertSegment(segment);
  return [TENANT_PREFIX, ...segments].join(":");
}

/** Leading marker of every user-scoped topic. */
const USER_PREFIX = "user";

/**
 * Build the canonical user-scoped topic: `user:<userId>:<domain>[:…]`.
 *
 * The second scheme, and it exists because the first cannot reach everyone.
 * Tenant topics authorize from the topic name — "which tenant, which domain" —
 * which is exactly right for a kitchen board and useless for a SHOPPER, who
 * belongs to no tenant at all. Anything addressed to a person rather than a
 * store had nowhere to go: a buyer's order updates, their notifications, or
 * being told their terms acceptance just went stale (FUT-462).
 *
 * Same shape and the same guarantee: the subject id comes FIRST, so the host's
 * subscribe endpoint decides "is this the caller?" from the topic name alone,
 * and a subscriber cannot smuggle another user's id into a later segment
 * because segments may not contain `:`.
 *
 * Throws {@link InvalidTopicError} on an empty or separator-carrying segment.
 */
export function userTopic(userId: string, domain: string, ...qualifiers: string[]): string {
  const segments = [userId, domain, ...qualifiers];
  for (const segment of segments) assertSegment(segment);
  return [USER_PREFIX, ...segments].join(":");
}

/** A parsed user-scoped topic. */
export interface ParsedUserTopic {
  userId: string;
  domain: string;
  /** Qualifier segments after the domain, possibly empty. */
  qualifiers: string[];
}

/**
 * Parse a user-scoped topic, or return `null` for anything else.
 *
 * The host compares `userId` against the SESSION's user before subscribing —
 * that comparison is the whole authorization, so this deliberately returns the
 * id rather than a boolean: a helper that answered "is this mine?" would need
 * the session, and the session does not belong in this package.
 */
export function parseUserTopic(topic: string): ParsedUserTopic | null {
  const segments = topic.split(":");
  if (segments.length < 3 || segments[0] !== USER_PREFIX) return null;
  const [, userId, domain, ...qualifiers] = segments;
  if (!userId || !domain) return null;
  return { userId: userId as string, domain: domain as string, qualifiers };
}

/** A parsed tenant-scoped topic. */
export interface ParsedTenantTopic {
  tenantId: string;
  domain: string;
  /** Qualifier segments after the domain, possibly empty. */
  qualifiers: string[];
}

/**
 * Parse a tenant-scoped topic, or return `null` for anything else (including
 * a non-`tenant:` topic — those exist for internal/system streams and are the
 * host's business to authorize).
 */
export function parseTenantTopic(topic: string): ParsedTenantTopic | null {
  const segments = topic.split(":");
  if (segments.length < 3 || segments[0] !== TENANT_PREFIX) return null;
  const [, tenantId, domain, ...qualifiers] = segments;
  if (!tenantId || !domain) return null;
  return { tenantId: tenantId as string, domain: domain as string, qualifiers };
}

/** Whether `topic` is a well-formed topic name (any scheme, no empty segments). */
export function isValidTopic(topic: string): boolean {
  const segments = topic.split(":");
  return segments.length > 0 && segments.every((segment) => SEGMENT_RE.test(segment));
}
