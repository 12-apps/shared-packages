import {
  PRESENCE_RENEW_MS,
  PRESENCE_TOPIC,
  presenceChangesOf,
  presenceHolderOf,
  type PresenceChange,
} from "./presence";
import { subscribeRealtime } from "./runtime";
import type { RealtimeLogger, Unsubscribe } from "./types";

/**
 * The host's half of presence: every holder's changes, merged into one answer per
 * key — "is ANY connection holding this open?" — and handed to `onChange` in order.
 *
 * ## Merged across holders
 *
 * One key can be held in two processes at once: a diner's SSE stream rotating onto
 * another API replica, a tab on the socket beside one demoted to SSE, a gateway
 * restarting while its clients reconnect to the next one. Each holder refcounts its
 * own connections and names itself on every event, so the listener keeps the set of
 * holders per key and reports `released` only when the LAST one lets go. A holder
 * that has not renewed for {@link PRESENCE_LEASE_RENEWALS} renewals is treated as
 * gone: it crashed, or its release was lost.
 *
 * ## A short grace before a release
 *
 * A connection that closes and reopens a moment later — a page navigation that
 * remounts its provider, a deploy, an SSE stream's planned rotation — would otherwise
 * read as "left, then arrived": two writes, two hints, and everybody else's screen
 * flickering for a person who never went anywhere. So a release is reported only
 * once {@link PRESENCE_RELEASE_GRACE_MS} has passed with no holder taking the key
 * back. Here rather than in each holder, because the re-hold often lands in a
 * DIFFERENT process from the release, which a holder cannot see.
 *
 * ## Order, and idempotence
 *
 * Changes to ONE key reach `onChange` in order, each after the previous one's
 * promise settles: a `held` and a `released` back to back must not be written in the
 * opposite order by an async handler. Different keys do not wait on each other. A
 * renewal is reported as a `held` again, so a host's lease stays fresh; handlers
 * write state and never count events.
 */

/** How long a release waits for a re-hold before it is reported. */
export const PRESENCE_RELEASE_GRACE_MS = 4_000;

/** Renewals a holder may miss before the listener stops counting it. */
const PRESENCE_LEASE_RENEWALS = 2.5;

export interface PresenceListenerOptions {
  /** Default {@link PRESENCE_RELEASE_GRACE_MS}; `0` reports a release at once. */
  releaseGraceMs?: number;
  /** The holders' renewal cadence; default `PRESENCE_RENEW_MS`. */
  renewMs?: number;
  /** The clock; injected by tests. */
  now?: () => number;
}

type Handler = (change: PresenceChange) => void | Promise<void>;

/** One key: who holds it (holder → last heard), and a release waiting out its grace. */
interface KeyState {
  holders: Map<string, number>;
  pendingRelease: ReturnType<typeof setTimeout> | null;
}

/**
 * The merged view, one per listener. Kept apart from the bus subscription so the
 * rules read on their own: what a held does, what a released does, what a grace
 * expiring does.
 */
class PresenceView {
  private readonly keys = new Map<string, KeyState>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly leaseMs: number;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(
    private readonly onChange: Handler,
    private readonly logger: RealtimeLogger,
    options: PresenceListenerOptions,
  ) {
    const renewMs = options.renewMs ?? PRESENCE_RENEW_MS;
    this.leaseMs = renewMs * PRESENCE_LEASE_RENEWALS;
    this.graceMs = options.releaseGraceMs ?? PRESENCE_RELEASE_GRACE_MS;
    this.now = options.now ?? Date.now;
    // Forgets holders that went silent, so a crashed process is not remembered
    // for the life of this one. Silent: the host's own lease covers the write.
    this.sweep = setInterval(() => this.forgetStale(), this.leaseMs);
    (this.sweep as { unref?: () => void }).unref?.();
  }

  held(key: string, holder: string): void {
    const state = this.stateOf(key);
    state.holders.set(holder, this.now());
    if (state.pendingRelease !== null) {
      // Taken back inside the grace: the release is never reported.
      clearTimeout(state.pendingRelease);
      state.pendingRelease = null;
    }
    this.deliver({ key, state: "held" });
  }

  released(key: string, holder: string): void {
    // A key this listener never saw held (it started after the hold) is still
    // reported: the host may have written it from an earlier process.
    const state = this.stateOf(key);
    state.holders.delete(holder);
    this.dropStaleHolders(state);
    if (state.holders.size > 0 || state.pendingRelease !== null) return;
    if (this.graceMs <= 0) {
      this.finishRelease(key);
      return;
    }
    state.pendingRelease = setTimeout(() => this.finishRelease(key), this.graceMs);
    (state.pendingRelease as { unref?: () => void }).unref?.();
  }

  /** Stop listening: a release still waiting out its grace is reported NOW. */
  close(): void {
    clearInterval(this.sweep);
    for (const [key, state] of this.keys) {
      if (state.pendingRelease === null) continue;
      clearTimeout(state.pendingRelease);
      this.finishRelease(key);
    }
  }

  private finishRelease(key: string): void {
    const state = this.keys.get(key);
    if (!state || state.holders.size > 0) return;
    this.keys.delete(key);
    this.deliver({ key, state: "released" });
  }

  private stateOf(key: string): KeyState {
    let state = this.keys.get(key);
    if (!state) {
      state = { holders: new Map(), pendingRelease: null };
      this.keys.set(key, state);
    }
    return state;
  }

  private dropStaleHolders(state: KeyState): void {
    const oldest = this.now() - this.leaseMs;
    for (const [holder, heardAt] of state.holders) {
      if (heardAt < oldest) state.holders.delete(holder);
    }
  }

  private forgetStale(): void {
    for (const [key, state] of this.keys) {
      this.dropStaleHolders(state);
      if (state.holders.size === 0 && state.pendingRelease === null) this.keys.delete(key);
    }
  }

  private deliver(change: PresenceChange): void {
    const previous = this.chains.get(change.key) ?? Promise.resolve();
    const next = previous
      .then(() => this.onChange(change))
      .catch((error: unknown) =>
        this.logger.error(`presence handler failed for a "${change.state}":`, error),
      );
    this.chains.set(change.key, next);
    void next.finally(() => {
      if (this.chains.get(change.key) === next) this.chains.delete(change.key);
    });
  }
}

/**
 * Listen to presence changes from every holder process, merged per key (see the
 * module doc). A throwing handler is logged and never stops the listener.
 */
export async function subscribePresence(
  onChange: Handler,
  logger: RealtimeLogger = console,
  options: PresenceListenerOptions = {},
): Promise<Unsubscribe> {
  const view = new PresenceView(onChange, logger, options);
  let unsubscribe: Unsubscribe;
  try {
    unsubscribe = await subscribeRealtime(PRESENCE_TOPIC, (_topic, event) => {
      const holder = presenceHolderOf(event);
      for (const change of presenceChangesOf(event)) {
        if (change.state === "held") view.held(change.key, holder);
        else view.released(change.key, holder);
      }
    });
  } catch (error) {
    view.close();
    throw error;
  }
  return async () => {
    view.close();
    await unsubscribe();
  };
}
