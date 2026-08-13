import { createInlineRealtimeDriver } from "../drivers/inline";
import type { RealtimeDriver, RealtimeLogger } from "../core/types";

/**
 * Which driver this process runs — ported from future-pay's
 * `apps/web/lib/realtime/runtime.ts` (FUT-438), the only place that decision
 * was ever made. Mirrors `@12-apps/jobs`' `resolve-driver` because the seam is
 * the same:
 *
 *   - `REDIS_URL` set → the REDIS pub/sub driver. Events cross processes, so
 *     a job handler running in the worker container reaches an SSE stream
 *     held open by the web container.
 *   - no Redis outside production → the INLINE driver. Handlers and streams
 *     share a process, so dev, PGlite and e2e stay Docker-free.
 *   - no Redis in production → OFF, loudly. The subscribe endpoint answers
 *     503 and every consumer keeps polling (the designed fallback), so a
 *     misconfigured bus degrades latency, never correctness.
 *
 * ## Fail closed, never fail loud
 *
 * Every problem here resolves to NO driver plus an error log: publishes then
 * report `no-driver` instead of throwing, and the clients poll.
 */

/** What `REALTIME_DRIVER` may say. */
type DriverChoice = "redis" | "inline" | "off";

function readDriverChoice(logger: RealtimeLogger): DriverChoice {
  const configured = process.env.REALTIME_DRIVER?.trim().toLowerCase();
  if (configured === "redis" || configured === "inline" || configured === "off") {
    return configured;
  }
  if (configured) {
    logger.error(`REALTIME_DRIVER="${configured}" is not a driver; realtime is disabled.`);
    return "off";
  }
  // Unset: Redis being configured is the signal that a cross-process bus exists.
  if (process.env.REDIS_URL) return "redis";
  return process.env.NODE_ENV === "production" ? "off" : "inline";
}

/** Resolve the driver from the environment, or `null` for "no bus here". */
export async function resolveRealtimeDriver(
  logger: RealtimeLogger,
): Promise<RealtimeDriver | null> {
  const choice = readDriverChoice(logger);
  const isProduction = process.env.NODE_ENV === "production";

  if (choice === "off") {
    if (isProduction) {
      logger.error(
        "No realtime driver: live updates will NOT stream (clients fall back to polling). Set REDIS_URL.",
      );
    }
    return null;
  }

  if (choice === "inline") {
    if (isProduction) {
      // Inline delivery cannot cross a process boundary, so a worker's publish
      // would silently never reach the web process's subscribers.
      logger.error("REALTIME_DRIVER=inline is refused in production; realtime is disabled.");
      return null;
    }
    logger.info("using the inline realtime driver (no Redis): events stay in-process.");
    return createInlineRealtimeDriver({ logger });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error("REALTIME_DRIVER=redis needs REDIS_URL; realtime is disabled.");
    return null;
  }
  try {
    // Imported lazily so ioredis is pulled in only by a process that actually
    // talks to Redis.
    const { createRedisRealtimeDriver } = await import("../drivers/redis");
    return createRedisRealtimeDriver({ redisUrl, logger });
  } catch (error) {
    logger.error("could not create the Redis realtime driver; realtime is disabled:", error);
    return null;
  }
}
