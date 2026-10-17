import { isValidPresenceKey } from "./presence-keys";
import { publishRealtimeEvent } from "./runtime";
import type { PublishResult, RealtimeEvent, RealtimeEventInput, RealtimeLogger } from "./types";

/**
 * Presence that lasts exactly as long as a connection — the capability a host asks
 * for when "is this person here right now?" must not cost a heartbeat poll.
 *
 * ## The question it answers, and the one it does not
 *
 * A host often draws who else is here: the other people sharing a bill, the people
 * on a shared screen. The old way to know was a timer in every browser re-announcing
 * itself every few seconds, and a TTL on the server deciding that silence meant
 * gone. That is a poll whose only job is to say "still here", on the surface with
 * the most devices, and the honest signal was already open the whole time: the
 * person's realtime connection.
 *
 * So presence is the CONNECTION's lifetime. The host's `authorize` names the
 * presence keys a connection holds (`EventsAuthorization.presence`), the API signs
 * them into the ticket beside the topics, and whichever process holds the socket —
 * the gateway, or the API itself for an SSE stream — reports the key as HELD when
 * the first connection for it opens and RELEASED when the last one closes. The
 * host hears both through `createApiEvents({ presence: { onChange } })`, which is
 * where it writes whatever "present" means to it.
 *
 * What it does not answer is whether the person is LOOKING. A hidden tab whose
 * socket is open is present; that is the definition, and a host that needs "on
 * screen" asks the page, not the wire.
 *
 * ## Why it crosses the bus, and why that is safe
 *
 * The gateway is a separate process with no database and no host code, and it
 * must stay that way (`../gateway/index.ts`). So it does not CALL the host: it
 * publishes on {@link PRESENCE_TOPIC}, a reserved name no ticket can carry
 * (`./ticket.ts` refuses `$…` topics), and the API process subscribes. An SSE
 * stream takes the same road, so a host has one listener whichever wire the
 * browser ended up on.
 *
 * A key is the HOST's opaque string, built by `authorize` from ids it resolved
 * itself — the same property topics have. The browser never names one, so a
 * client cannot claim to be somebody else, and a key carries no meaning here.
 *
 * ## Best-effort, so it is a LEASE and not a flag
 *
 * The bus has no replay and a process can die without saying goodbye. Two
 * consequences, both the host's to honour:
 *
 *  - **Renewal.** While a key is held, its holder re-announces it every
 *    {@link PRESENCE_RENEW_MS} from the server, with no request from any browser.
 *    A host records "present until now + lease" and must make its lease outlive at
 *    least two renewals, so a holder that crashed (no `released` ever sent) lapses
 *    on its own and a lost `held` is repaired by the next renewal.
 *  - **Idempotence.** Every API process that listens hears every change, and a
 *    renewal repeats a `held` the host already has. Handle both by writing state,
 *    never by counting events.
 *
 * Refcounting is per holder PROCESS: two tabs on one gateway are one hold, and
 * the key is released when the second closes. Every event names its holder, so
 * the listener (`./presence-listener.ts`) merges holders in DIFFERENT processes —
 * an SSE stream on one API replica and a socket on the gateway — and reports a
 * key released only when no holder still has it. The listener also waits a short
 * grace before reporting a release, so a connection that closes and reopens (a
 * page navigation, a deploy, an SSE stream's planned rotation) never flickers.
 */

/**
 * The reserved bus channel presence changes travel on. `$` cannot appear in a host
 * topic — those are built from validated segments, and a ticket refuses one.
 */
export const PRESENCE_TOPIC = "$presence";

/** How often a holder re-announces the keys it holds. A host's lease must outlive two of these. */
export const PRESENCE_RENEW_MS = 10_000;

/**
 * The most keys one event carries. A renewal re-announces every key a process
 * holds, and a gateway can hold thousands: one frame per this many keeps every
 * bus message small, whatever the fleet's size.
 */
export const PRESENCE_EVENT_MAX_KEYS = 200;

/** The wire-stable event names on {@link PRESENCE_TOPIC}. */
const HELD = "presence.held";
const RELEASED = "presence.released";

/** What one {@link PRESENCE_TOPIC} event carries. `holder` is absent from older holders. */
interface PresencePayload {
  keys: string[];
  holder: string;
}

/**
 * A holder's identity on the bus: random per process, never a secret and never a
 * person — only what lets a listener tell two holders of one key apart.
 */
function newHolderId(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export { isValidPresenceKey, isValidPresenceList, MAX_PRESENCE_KEYS } from "./presence-keys";

/** What a host's listener receives — one key, and what just happened to it. */
export interface PresenceChange {
  key: string;
  /**
   * `held`: a connection holding this key is open (on open, and on every
   * renewal). `released`: the last connection holding it in that process closed.
   */
  state: "held" | "released";
}

/** The publish seam, so a test can watch the wire without a driver. */
type Publish = (topic: string, input: RealtimeEventInput<PresencePayload>) => Promise<PublishResult>;

export interface PresenceTrackerOptions {
  /** Renewal cadence; default {@link PRESENCE_RENEW_MS}. */
  renewMs?: number;
  logger?: RealtimeLogger;
  /** Defaults to the runtime's {@link publishRealtimeEvent}. */
  publish?: Publish;
  /** This process's holder id on the bus; random by default. */
  holder?: string;
}

/**
 * The keys this PROCESS holds open, refcounted by connection.
 *
 * One per gateway and one per `createApiEvents`, never shared: each is the
 * authority for its own sockets, and nothing else.
 */
export class PresenceTracker {
  private readonly holds = new Map<string, number>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly renewMs: number;
  private readonly logger: RealtimeLogger;
  private readonly publish: Publish;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  /** Named on every event, so a listener can merge holders across processes. */
  readonly holder: string;

  constructor(options: PresenceTrackerOptions = {}) {
    this.renewMs = options.renewMs ?? PRESENCE_RENEW_MS;
    this.logger = options.logger ?? console;
    this.publish = options.publish ?? publishRealtimeEvent;
    this.holder = options.holder ?? newHolderId();
  }

  /** How many distinct keys are held — for tests and health readouts. */
  get size(): number {
    return this.holds.size;
  }

  /**
   * One connection opened holding `keys`. Returns its release, which is
   * idempotent: a connection's cleanup can run from more than one exit path.
   */
  hold(keys: readonly string[]): () => void {
    const valid = keys.filter(isValidPresenceKey);
    if (valid.length === 0) return () => undefined;
    const arrived: string[] = [];
    for (const key of valid) {
      const open = this.holds.get(key) ?? 0;
      this.holds.set(key, open + 1);
      if (open === 0) arrived.push(key);
    }
    if (arrived.length > 0) this.emit(HELD, arrived);
    this.syncTimer();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(valid);
    };
  }

  /** Release every key and stop renewing — the shutdown path, awaited. */
  async releaseAll(): Promise<void> {
    const keys = [...this.holds.keys()];
    this.holds.clear();
    this.syncTimer();
    if (keys.length > 0) this.emit(RELEASED, keys);
    await this.flush();
  }

  /** Wait for every announcement already sent to settle. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private release(keys: readonly string[]): void {
    const left: string[] = [];
    for (const key of keys) {
      const open = this.holds.get(key) ?? 0;
      if (open <= 1) {
        // A key releaseAll already dropped is not announced twice.
        if (this.holds.delete(key)) left.push(key);
      } else {
        this.holds.set(key, open - 1);
      }
    }
    if (left.length > 0) this.emit(RELEASED, left);
    this.syncTimer();
  }

  /** Renew while anything is held, and only then: an idle process schedules nothing. */
  private syncTimer(): void {
    if (this.holds.size > 0 && this.renewTimer === null) {
      this.renewTimer = setInterval(() => this.emit(HELD, [...this.holds.keys()]), this.renewMs);
      // A renewal must never be what keeps a process alive on its way out.
      (this.renewTimer as { unref?: () => void }).unref?.();
    } else if (this.holds.size === 0 && this.renewTimer !== null) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  /** Announce `keys`, at most {@link PRESENCE_EVENT_MAX_KEYS} per event. */
  private emit(type: string, keys: string[]): void {
    for (let start = 0; start < keys.length; start += PRESENCE_EVENT_MAX_KEYS) {
      this.send(type, keys.slice(start, start + PRESENCE_EVENT_MAX_KEYS));
    }
  }

  private send(type: string, keys: string[]): void {
    const sent = this.publish(PRESENCE_TOPIC, { type, data: { keys, holder: this.holder } })
      .then((result) => {
        if (!result.published) {
          this.logger.warn(`presence "${type}" for ${keys.length} key(s) was not published.`);
        }
      })
      .catch((error: unknown) => this.logger.error(`presence "${type}" failed:`, error));
    this.pending.add(sent);
    void sent.finally(() => this.pending.delete(sent));
  }
}

/** The changes one {@link PRESENCE_TOPIC} event carries, or none for a malformed one. */
export function presenceChangesOf(event: RealtimeEvent): PresenceChange[] {
  const state = event.type === HELD ? "held" : event.type === RELEASED ? "released" : null;
  if (state === null) return [];
  const keys = (event.data as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return [];
  return keys.filter(isValidPresenceKey).map((key) => ({ key, state }));
}

/**
 * Which holder sent an event — `""` for a holder too old to name itself, which a
 * listener then treats as one holder of its own.
 */
export function presenceHolderOf(event: RealtimeEvent): string {
  const holder = (event.data as { holder?: unknown } | null)?.holder;
  return typeof holder === "string" ? holder : "";
}
