import type { JobDriver } from "../core/types";
import { createInlineJobDriver } from "../drivers/inline";

import type { JobsDriverChoice, JobsServerConfig, ResolvedConfig } from "./config";

/**
 * Driver resolution — future-pay `runtime.ts`'s `readDriverChoice` +
 * `resolveDriver`, moved whole. The choice can also arrive through
 * `config.driver` (a name or an instance), which future-pay had no seam for.
 */

function resolveChoice(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): JobsDriverChoice {
  if (typeof config.driver === "string") return config.driver;
  const configured = process.env.JOBS_DRIVER?.trim().toLowerCase();
  if (configured === "bullmq" || configured === "inline" || configured === "off") {
    return configured;
  }
  if (configured) {
    resolved.logger.error(
      `JOBS_DRIVER="${configured}" is not a driver; jobs are disabled.`,
    );
    return "off";
  }
  // Unset: Redis being configured is the signal that a queue exists.
  if (resolved.redisUrl) return "bullmq";
  return resolved.production ? "off" : "inline";
}

/**
 * Pick the driver, or NULL for "jobs are disabled in this process" — which is
 * always accompanied by a loud log line, never silent.
 */
export async function resolveDriver(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): Promise<JobDriver | null> {
  // An instance passed in is the host's own decision; use it as-is.
  if (config.driver && typeof config.driver === "object") return config.driver;

  const choice = resolveChoice(config, resolved);
  const { logger, production, redisUrl } = resolved;

  if (choice === "off") {
    if (production) {
      logger.error(
        "No job driver: scheduled work will NOT run in this deployment. Set REDIS_URL.",
      );
    }
    return null;
  }

  if (choice === "inline") {
    if (production) {
      // Inline runs the handler inside whatever request enqueued it and has
      // no retries and no schedules. That is a development convenience, and
      // in production it would silently drop work a crash interrupts.
      logger.error("JOBS_DRIVER=inline is refused in production; jobs are disabled.");
      return null;
    }
    logger.info("using the inline job driver (no Redis): schedules will not fire.");
    // Detached on purpose: in a dev server the handler must not run inside
    // the request that enqueued it. A test that wants to await the handler
    // passes its own `createInlineJobDriver({ await: true })` instance.
    return createInlineJobDriver({ logger, await: false });
  }

  if (!redisUrl) {
    logger.error("JOBS_DRIVER=bullmq needs REDIS_URL; jobs are disabled.");
    return null;
  }
  try {
    // Imported lazily so `bullmq` (and ioredis) are pulled in only by a
    // process that actually talks to Redis — never into a bundle that only
    // enqueues. The specifier is a literal, which is what keeps it loadable
    // once the host bundles this package's published TS source.
    const { createBullMqJobDriver } = await import("../drivers/bullmq");
    return createBullMqJobDriver({
      redisUrl,
      logger,
      prefix: resolved.queuePrefix,
    });
  } catch (error) {
    logger.error("could not create the BullMQ driver; jobs are disabled:", error);
    return null;
  }
}
