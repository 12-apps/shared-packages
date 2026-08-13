import type { RealtimeMessage } from "./types";

/**
 * Telling a quiet channel from a broken one (FUT-657).
 *
 * ## The distinction this module exists for
 *
 * Breaking was always handled. A dropped stream raises `onerror`, the channel
 * reports `disconnected` immediately, and every consumer flips back to its fast
 * poll — that path is old and tested.
 *
 * LYING was not. A socket that is open, healthy at the transport layer and
 * answering the server's protocol ping can still deliver nothing. The status stays
 * `connected`, `reconcileRefetchInterval` keeps the poll relaxed, and the screen
 * ends up STALER than it was before realtime existed — on a kitchen board, 30s
 * where it used to be 5s.
 *
 * What these cases have in common is that NOTHING FAILED, which is why no retry
 * anywhere helps and why the detection has to be here:
 *
 * - A gateway subscribed to names nobody publishes to. The SUBSCRIBE succeeds — on
 *   a channel nothing will ever send to.
 * - A driver's `subscribedTopics` set believing a topic is subscribed when the
 *   backend no longer has it. That set short-circuits re-subscription, so retry is
 *   not merely absent, it is prevented.
 *
 * A subscribe that genuinely FAILS is not in this list and was never the problem:
 * the gateway closes the socket with 1011, the client sees a drop and reconnects.
 *
 * There is no event to react to, so the only evidence is the absence of one. That
 * is why both wires emit a heartbeat the client can actually see: the SSE route
 * writes a `data:` frame rather than a `: hb` comment (a comment never fires
 * `onmessage`), and the gateway sends an application frame beside its `ws.ping()`
 * (the browser answers a protocol ping itself, without telling the page).
 */

/**
 * The reserved topic both wires put control frames on.
 *
 * Kept in sync with `../gateway/connection.ts` and `../server/sse.ts`. `$` cannot
 * appear in a real topic — those are built by `tenantTopic()` from validated
 * segments — so this namespace can never collide with a subscription.
 */
export const CONTROL_TOPIC = "$gateway";

/**
 * How long a connected channel may hear NOTHING before it stops believing it.
 *
 * Both wires beat every 25s, so this is three of them: two may be lost to jitter, a
 * slow network or a tab the browser throttled, and the channel still holds. Tighter
 * and a genuinely quiet store flaps, losing the relaxed poll that is the entire
 * benefit; looser and a broken channel goes on lying for minutes, which is the bug.
 */
export const SILENCE_LIMIT_MS = 75_000;

/** How often silence is checked. One timer per channel; cheap. */
export const SILENCE_CHECK_MS = 5_000;

/**
 * What a heartbeat frame carries, once validated.
 *
 * Not exported: both functions that touch it live here, and `readHeartbeat`'s
 * return type is reachable by inference.
 */
interface Heartbeat {
  /** The topics the SERVER says it is serving this connection. */
  topics: string[];
}

/** The `topics` array out of a control frame's payload, defaulting to empty. */
function topicsOf(data: unknown): string[] {
  const payload = data as { topics?: unknown } | null;
  if (!Array.isArray(payload?.topics)) return [];
  return payload.topics.filter((topic): topic is string => typeof topic === "string");
}

/**
 * Read a control frame, or `null` if it is not a heartbeat.
 *
 * The topic list is the half that catches a channel which is alive but wrong.
 * Liveness on its own would vouch for a gateway that heartbeats perfectly while
 * subscribed to names nobody publishes to.
 */
export function readHeartbeat(message: RealtimeMessage): Heartbeat | null {
  if (message.topic !== CONTROL_TOPIC || message.type !== "hb") return null;
  return { topics: topicsOf(message.data) };
}

/**
 * Every control frame that reports what the gateway believes it is SERVING.
 *
 * All four carry the same `{ topics }` payload — the heartbeat volunteers it, the
 * other three are answers to a client frame. They are read together because the
 * reader wants the same thing from all of them: the RESOLVED topic names, which is
 * the one piece of information the client cannot derive on its own. It holds domain
 * names (`kitchen`); the server holds `tenant:<id>:kitchen`; only the ticket maps
 * between them and the client must never parse a credential. Without this, a shell
 * that owns one connection could widen a subscription but never narrow it —
 * `unsubscribe` names topics, and only the server-side spelling counts.
 */
const SERVED_TOPIC_TYPES: ReadonlySet<string> = new Set([
  "hb",
  "pong",
  "subscribed",
  "unsubscribed",
]);

/**
 * The served topic list out of any control frame that reports one, else `null`.
 *
 * `null` and `[]` are different answers and the caller must not conflate them:
 * `null` is "this frame said nothing about topics", `[]` is "the gateway is serving
 * none". Only the second is evidence of anything.
 */
export function readServedTopics(message: RealtimeMessage): string[] | null {
  if (message.topic !== CONTROL_TOPIC) return null;
  if (!SERVED_TOPIC_TYPES.has(message.type)) return null;
  return topicsOf(message.data);
}

/**
 * Whether a heartbeat is evidence the channel is BROKEN rather than merely quiet.
 *
 * Zero topics is the unambiguous case and the only one decidable here: whatever
 * that gateway is doing, it is not serving this subscription. Comparing the names
 * against what the client asked for would catch more, but the client holds domain
 * names (`kitchen`) while the server holds resolved ones (`tenant:<id>:kitchen`),
 * and only the WebSocket wire has the ticket that maps between them — so it is not
 * a check both wires could make, and a check only one wire makes is how the two
 * drift.
 */
export function heartbeatProvesBroken(beat: Heartbeat): boolean {
  return beat.topics.length === 0;
}

/**
 * A timer that fires when nothing has arrived for too long.
 *
 * Owns no channel state: the caller says when something happened and what to do
 * when the silence is too long, which keeps the rule testable without a wire, a
 * clock or a channel.
 */
export class SilenceWatch {
  private lastActivityMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onSilent: () => void,
    private readonly isWatching: () => boolean,
  ) {}

  /** Something arrived. ANY frame counts — an event is better proof than a beat. */
  note(nowMs: number): void {
    this.lastActivityMs = nowMs;
  }

  start(nowMs: number): void {
    if (this.timer) return;
    this.note(nowMs);
    this.timer = setInterval(() => {
      if (!this.isWatching()) return;
      if (Date.now() - this.lastActivityMs <= SILENCE_LIMIT_MS) return;
      this.onSilent();
    }, SILENCE_CHECK_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
