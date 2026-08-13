/**
 * The process-wide realtime runtime: which driver is installed, and the
 * publish / subscribe / stop entry points everything else goes through.
 *
 * Mirrors `@12-apps/jobs`' runtime exactly: the host's bootstrap installs one
 * driver per process (`configureRealtime`), publishers call
 * `publishRealtimeEvent` from anywhere (a route, a job handler), and the
 * host's subscribe endpoint calls `subscribeRealtime` per client connection.
 */

import { isValidTopic } from "./topics";
import type {
  PublishResult,
  RealtimeDriver,
  RealtimeEvent,
  RealtimeEventInput,
  RealtimeHandler,
  RealtimeLogger,
  Unsubscribe,
} from "./types";

/** Fallback logger — used until the host installs its own. */
const consoleLogger: RealtimeLogger = {
  info: (message, ...meta) => console.info(`[realtime] ${message}`, ...meta),
  warn: (message, ...meta) => console.warn(`[realtime] ${message}`, ...meta),
  error: (message, ...meta) => console.error(`[realtime] ${message}`, ...meta),
};

let driver: RealtimeDriver | null = null;
let logger: RealtimeLogger = consoleLogger;
let sequence = 0;

/** Install the driver (and optionally the host's logger) for this process. */
export function configureRealtime(options: {
  driver: RealtimeDriver;
  logger?: RealtimeLogger;
}): void {
  driver = options.driver;
  if (options.logger) logger = options.logger;
  logger.info(`runtime configured with the "${options.driver.kind}" driver`);
}

/** The installed driver, or `null` in a process that never configured one. */
export function getRealtimeDriver(): RealtimeDriver | null {
  return driver;
}

/**
 * Stamp the envelope: unique-enough id (per-process monotonic) + timestamp.
 *
 * A publisher-supplied `id` wins — see `RealtimeEventInput.id`. Only the
 * transactional outbox uses that, because its publish is at-least-once and a
 * re-publish has to be recognisable as the same event.
 */
function toEvent<TData>(input: RealtimeEventInput<TData>): RealtimeEvent<TData> {
  sequence += 1;
  return {
    type: input.type,
    data: input.data,
    ts: Date.now(),
    id: input.id ?? `${Date.now().toString(36)}-${sequence.toString(36)}`,
  };
}

/**
 * Publish one event to `topic`.
 *
 * **Never throws.** Realtime is a latency optimisation over the consumers'
 * polling fallback — a bus outage (Redis down, no driver configured) must
 * degrade to "the client's next poll sees the new state", not fail the
 * checkout or job that emitted the event. Failures are logged loudly and
 * reported in the result for callers that care.
 */
export async function publishRealtimeEvent<TData>(
  topic: string,
  input: RealtimeEventInput<TData>,
): Promise<PublishResult> {
  if (!driver) {
    logger.warn(`"${input.type}" was not published: no driver is configured in this process.`);
    return { published: false, reason: "no-driver" };
  }
  if (!isValidTopic(topic)) {
    logger.error(`"${input.type}" was not published: malformed topic "${topic}".`);
    return { published: false, reason: "invalid-topic" };
  }
  try {
    await driver.publish(topic, toEvent(input));
    return { published: true };
  } catch (error) {
    logger.error(`publish of "${input.type}" to "${topic}" failed:`, error);
    return { published: false, reason: "error" };
  }
}

/**
 * Subscribe `handler` to `topic`. Resolves once the subscription is live.
 * Throws when no driver is configured — a subscribe endpoint must answer
 * "realtime is off" explicitly rather than hold a connection that will never
 * receive anything.
 */
export async function subscribeRealtime(
  topic: string,
  handler: RealtimeHandler,
): Promise<Unsubscribe> {
  if (!driver) throw new Error("subscribeRealtime(): no driver configured.");
  return driver.subscribe(topic, handler);
}

/** Release the driver's connections. */
export async function stopRealtime(): Promise<void> {
  if (!driver) return;
  await driver.close();
  logger.info("realtime stopped.");
}

/** Test-only: forget the installed driver and logger. */
export function resetRealtimeRuntime(): void {
  driver = null;
  logger = consoleLogger;
}
