import type { RealtimeMessage } from "./types";

/**
 * Who wants which topics, and where each event goes (FUT-659).
 *
 * ## Why this is a plain class and not a hook
 *
 * The shell owns ONE connection for many screens, which means two questions that used
 * to be answered by the wire itself now have to be answered in code: what the union
 * of everyone's topics is, and which of the screens an arriving event belongs to.
 * Neither involves React, a socket or a clock — so neither lives with them. The
 * provider is then thin enough to be obviously correct, and these rules are tested
 * without mounting anything.
 */

/**
 * Does a RESOLVED server topic serve a client-side topic spec?
 *
 * The two spellings never match literally. A screen asks for `kitchen`, or
 * `research-run:<runId>`; the server publishes on `tenant:<tenantId>:kitchen` and
 * `tenant:<tenantId>:research-run:<runId>`. The spec is always the tail, and always
 * after a separator, so a suffix test is exact rather than approximate:
 *
 * - it cannot match a longer sibling — a screen on `kitchen` is NOT served by
 *   `tenant:x:kitchen:station-1`, and must not be: if it had wanted the station's
 *   topic it would have asked for it, and the unqualified one is a different
 *   subscription with different authorization;
 * - it cannot match a partial segment — `:kitchen` never falls inside `…:my-kitchen`,
 *   because the separator is part of the comparison.
 *
 * Deriving the match instead of asking the server keeps this working on BOTH wires:
 * the SSE stream carries resolved topics too and has no control frames to ask through.
 */
export function topicServes(resolvedTopic: string, spec: string): boolean {
  return resolvedTopic === spec || resolvedTopic.endsWith(`:${spec}`);
}

/** One screen's standing interest in some topics. */
export interface Subscription {
  /** Client-side topic specs, e.g. `["kitchen"]`. */
  topics: readonly string[];
  /** Called for each event on a topic this subscription asked for. */
  onMessage?: (message: RealtimeMessage) => void;
}

/** The handle a registered subscription holds for its own lifetime. */
export interface SubscriptionHandle {
  /** Replace what this subscription wants; recomputes the union if it moved. */
  update(next: Subscription): void;
  /** Deregister. The union shrinks unless someone else wanted the same topics. */
  release(): void;
}

/**
 * Sorted, de-duplicated — so an unchanged set compares equal every time.
 *
 * Shared with the SharedWorker hub (FUT-660), which merges the same way one level up:
 * topics across TABS rather than across screens. Two implementations of "what is the
 * union" would be two chances to disagree about whether it moved, and the whole design
 * turns on only reacting when it really did.
 */
export function mergeTopics(lists: Iterable<readonly string[]>): string[] {
  return [...new Set([...lists].flat())].sort();
}

function unionOf(subscriptions: Iterable<Subscription>): string[] {
  return mergeTopics([...subscriptions].map((subscription) => subscription.topics));
}

/** Element-wise equality of two ALREADY-SORTED lists (see `mergeTopics`). */
export function sameTopics(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((topic, index) => topic === right[index]);
}

export class SubscriptionRegistry {
  private readonly subscriptions = new Map<number, Subscription>();
  private nextId = 0;
  private currentUnion: readonly string[] = [];

  /**
   * `onUnionChange` fires only on a REAL change — never on a re-registration that
   * asks for what someone else already asked for, which is the common case when one
   * screen replaces another that watched the same domain.
   */
  constructor(private readonly onUnionChange: (union: readonly string[]) => void) {}

  get union(): readonly string[] {
    return this.currentUnion;
  }

  register(subscription: Subscription): SubscriptionHandle {
    const id = this.nextId++;
    this.subscriptions.set(id, subscription);
    this.recompute();
    return {
      update: (next) => {
        if (!this.subscriptions.has(id)) return;
        this.subscriptions.set(id, next);
        this.recompute();
      },
      release: () => {
        if (!this.subscriptions.delete(id)) return;
        this.recompute();
      },
    };
  }

  /**
   * Route one event to the subscriptions that asked for its topic.
   *
   * Filtering here is what keeps the shared connection invisible to a screen. Before
   * this, a channel carried only one screen's topics, so "it arrived" and "it is mine"
   * were the same statement; on a shared connection they are not, and a kitchen board
   * that invalidated on a tables event would re-read on every table change in the
   * building.
   */
  deliver(message: RealtimeMessage): void {
    for (const subscription of this.subscriptions.values()) {
      const wanted = subscription.topics.some((spec) => topicServes(message.topic, spec));
      if (wanted) subscription.onMessage?.(message);
    }
  }

  private recompute(): void {
    const next = unionOf(this.subscriptions.values());
    if (sameTopics(this.currentUnion, next)) return;
    this.currentUnion = next;
    this.onUnionChange(next);
  }
}
