import { isValidTopic } from "../core/topics";

import {
  EventsDenial,
  type EventsMessages,
  type EventsTopicSpec,
} from "./types";

/**
 * `?topics=` parsing for a subscribe surface — the deny-by-default half the
 * package owns, ported from the origin host's `apps/web/lib/realtime/topics.ts`.
 *
 * The surface declares which DOMAINS are subscribable, and which of those may
 * carry qualifiers; anything else in the query is a 400 before authorization ever
 * runs. What each domain DISCLOSES, and to whom, stays the host's — that is the
 * `authorize` seam — but the registry guarantees authorization never sees a name
 * nobody registered, and never sees a client-supplied qualifier on a domain whose
 * seam was not written to check one.
 *
 * Domain names are wire-stable: they appear in `?topics=` query strings, so a
 * host renaming one is a breaking change to every open tab.
 */

/** Default upper bound of domains one connection may watch — a fan-out guardrail. */
export const DEFAULT_MAX_TOPICS_PER_CONNECTION = 8;

/** What a surface allows in its `?topics=`. */
export interface TopicRegistry {
  domains: readonly string[];
  /** Subset of `domains` that may carry qualifier segments. Default: none. */
  qualifiedDomains?: readonly string[];
}

/**
 * Parse one `?topics=` entry (`<domain>[:<qualifier>…]`) into a spec, or `null`
 * for an unknown domain, a qualifier on a domain that does not take one, or a
 * malformed qualifier segment.
 */
export function toTopicSpec(
  value: string,
  registry: TopicRegistry,
): EventsTopicSpec | null {
  const [name = "", ...qualifiers] = value.split(":");
  if (!registry.domains.includes(name)) return null;
  if (qualifiers.length > 0 && !(registry.qualifiedDomains ?? []).includes(name)) {
    // A qualifier is the only client-controlled part of a resolved topic name.
    // A domain that never has a qualified form must not be able to receive one
    // — see `EventsSurfaceConfig.qualifiedDomains`.
    return null;
  }
  // Same segment rule `tenantTopic` enforces — vetted here so a bad qualifier is
  // a 400 at the endpoint, never a 500 out of the topic builder.
  if (!qualifiers.every((qualifier) => isValidTopic(qualifier))) return null;
  return { domain: name, qualifiers };
}

/**
 * Parse and validate a comma-separated topic list. Throws {@link EventsDenial}
 * (400) on an empty list, a list over `max`, or any refused entry.
 *
 * `messages` is REQUIRED — the refusal sentences are the host's (see
 * {@link EventsMessages}); a pt-BR host passes `PT_BR_EVENTS_MESSAGES`.
 */
export function parseTopicList(
  raw: string,
  registry: TopicRegistry,
  max: number,
  messages: EventsMessages,
): EventsTopicSpec[] {
  const names = [...new Set(raw.split(",").map((name) => name.trim()))].filter(Boolean);
  if (names.length === 0 || names.length > max) {
    throw new EventsDenial(400, messages.invalidTopics);
  }
  const specs: EventsTopicSpec[] = [];
  for (const name of names) {
    const spec = toTopicSpec(name, registry);
    // One message for "unknown domain" and for "that domain takes no qualifier":
    // both are "this surface does not serve that name", and spelling out which
    // half failed only tells a prober which one to vary.
    if (!spec) throw new EventsDenial(400, messages.unknownTopic(name));
    specs.push(spec);
  }
  return specs;
}
