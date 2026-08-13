import type { RealtimeMessage, RealtimeStatus } from "../types";

/**
 * What a tab and the SharedWorker say to each other (FUT-660).
 *
 * ## Why the protocol is this small
 *
 * The worker owns a connection; it owns nothing else. It has no idea which screen wants
 * what, does no authorization, and never interprets an event — a tab tells it which
 * topics it currently wants and gets back frames and a status. Routing to individual
 * screens stays in the tab, in the registry that already does it, because that is where
 * the components are.
 *
 * Keeping it this thin is what makes the worker optional rather than load-bearing: the
 * same tab-side code runs against an in-page channel when no SharedWorker exists (old
 * engine, a `type: "module"` worker the browser will not build, a test environment),
 * and nothing above notices which it got.
 *
 * ## Why liveness is explicit
 *
 * A SharedWorker is not told when a port goes away. Closing a tab, navigating it
 * elsewhere, or discarding it under memory pressure all leave a port that looks exactly
 * like an idle one. So a tab announces itself alive on a timer and says goodbye when it
 * can, and the worker sweeps whatever stops answering — otherwise a dead tab's topics
 * would hold a subscription open forever, which is a worse version of the leak this
 * arrangement is about.
 */

/** Sent by a tab. */
export type TabMessage =
  /**
   * "This is the endpoint I am on and everything I want from it." One verb for hello,
   * for a topic change and for a tenant switch: they are the same statement, and a
   * worker that cannot tell them apart cannot get them out of order either.
   */
  | { type: "subscribe"; endpoint: string; topics: readonly string[] }
  /** "Still here" — see the module docstring. */
  | { type: "alive" }
  /** "Going away", best effort: `pagehide` fires far more often than not. */
  | { type: "bye" };

/** Sent by the worker. */
export type WorkerMessage =
  /**
   * "The script is running and this port is attached." Posted on `onconnect`, before the
   * tab has said anything.
   *
   * It exists because a SharedWorker that never EXECUTES is indistinguishable from a
   * healthy idle one: `new SharedWorker(…)` succeeds, `port` is an object, and a bundler
   * that mis-emits the chunk (measured: Vite inlining the raw TypeScript as a `data:`
   * URI) leaves a port nothing will ever answer. Without a frame to wait for, the tab's
   * only symptom is a permanent `disconnected` beside `host === "shared-worker"` — no
   * error, no console warning, and the whole subsystem silently lost for that host.
   */
  | { type: "ready" }
  | { type: "status"; status: RealtimeStatus }
  | { type: "event"; message: RealtimeMessage };

/**
 * How long a SharedWorker has to answer before the page takes the connection back.
 *
 * A real worker answers in the same task it is connected in, so this is not a latency
 * budget — it is the gap between "starting" and "will never start". Generous enough that a
 * cold script compile on a slow device is not mistaken for a dead one, short enough that a
 * host whose bundler mis-emits the chunk loses one second rather than every event.
 */
export const WORKER_READY_MS = 1_000;

/** How often a tab announces itself. */
export const ALIVE_EVERY_MS = 15_000;

/**
 * How long a silent port is kept.
 *
 * Three missed announcements. Two would make a tab that the browser throttled — a
 * backgrounded kitchen tablet, the exact device this is for — look dead, and dropping
 * its topics mid-service is worse than holding them a little longer than needed.
 */
export const PORT_SILENCE_MS = 45_000;

/** How often the worker looks for ports that stopped answering. */
export const SWEEP_EVERY_MS = 20_000;

/** Parse a tab's message, or `null` for anything this protocol does not name. */
export function readTabMessage(data: unknown): TabMessage | null {
  if (data === null || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  if (body.type === "alive") return { type: "alive" };
  if (body.type === "bye") return { type: "bye" };
  if (body.type !== "subscribe") return null;
  if (typeof body.endpoint !== "string" || !body.endpoint) return null;
  if (!Array.isArray(body.topics)) return null;
  if (!body.topics.every((topic): topic is string => typeof topic === "string")) return null;
  return { type: "subscribe", endpoint: body.endpoint, topics: body.topics };
}
