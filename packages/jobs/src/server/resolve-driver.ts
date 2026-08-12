import type { JobDriver } from "../core/types";
import { createInlineJobDriver } from "../drivers/inline";

import type { JobsDriverChoice, JobsServerConfig, ResolvedConfig } from "./config";

/**
 * Driver resolution — future-pay `runtime.ts`'s `readDriverChoice` +
 * `resolveDriver`. The choice can also arrive through `config.driver` (a name
 * or an instance), which future-pay had no seam for — so the resolution
 * tracks WHERE the choice came from, validates the config path exactly as
 * strictly as the env path, and names the right knob in every error message.
 * The `JOBS_DRIVER=…` messages stay byte-identical to future-pay's, because
 * a host greps for them.
 */

/** A resolved choice, and which knob said so. */
interface DriverChoice {
  choice: JobsDriverChoice;
  /**
   * `env` is `JOBS_DRIVER`; `config` is `createApiJobs({ driver })`;
   * `default` is the matrix (Redis presence / production). An INVALID value
   * resolves to `off` with source `default`: a misconfiguration is not a
   * deliberate opt-out.
   */
  source: "config" | "env" | "default";
}

function resolveChoice(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): DriverChoice {
  if (typeof config.driver === "string") {
    const named = config.driver.trim().toLowerCase();
    if (named === "bullmq" || named === "inline" || named === "off") {
      return { choice: named, source: "config" };
    }
    // The type forbids this, but a JS consumer can pass anything — and the
    // env path validates, so the config path must too: same value, same
    // loud-and-off outcome, never a silent fallthrough to bullmq.
    resolved.logger.error(
      `createApiJobs({ driver: "${config.driver}" }) is not a driver; jobs are disabled.`,
    );
    return { choice: "off", source: "default" };
  }
  const configured = process.env.JOBS_DRIVER?.trim().toLowerCase();
  if (configured === "bullmq" || configured === "inline" || configured === "off") {
    return { choice: configured, source: "env" };
  }
  if (configured) {
    resolved.logger.error(
      `JOBS_DRIVER="${configured}" is not a driver; jobs are disabled.`,
    );
    return { choice: "off", source: "default" };
  }
  // Unset: Redis being configured is the signal that a queue exists.
  if (resolved.redisUrl) return { choice: "bullmq", source: "default" };
  return { choice: resolved.production ? "off" : "inline", source: "default" };
}

/**
 * Names the knob a choice came from, so an operator debugging the log line is
 * sent to the setting that actually said it — a `JOBS_DRIVER` message for a
 * choice made in code would have them hunting for an env var that is not set.
 */
function knob(choice: JobsDriverChoice, source: DriverChoice["source"]): string {
  return source === "config"
    ? `createApiJobs({ driver: "${choice}" })`
    : `JOBS_DRIVER=${choice}`;
}

/**
 * Pick the driver, or NULL for "jobs are disabled in this process" — which is
 * always accompanied by a loud log line, never silent.
 */
export async function resolveDriver(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): Promise<JobDriver | null> {
  const { logger, production, redisUrl } = resolved;

  // An instance passed in is the host's own decision — for anything except
  // the inline driver in production, which is refused for exactly the reason
  // the NAMED choice is (below): no retries, no schedules, and work that
  // dies with the request that enqueued it. An instance must not be the
  // quiet way around that guard.
  if (config.driver && typeof config.driver === "object") {
    if (production && config.driver.kind === "inline") {
      logger.error(
        "an inline driver instance is refused in production; jobs are disabled.",
      );
      return null;
    }
    return config.driver;
  }

  const { choice, source } = resolveChoice(config, resolved);

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
      logger.error(`${knob(choice, source)} is refused in production; jobs are disabled.`);
      return null;
    }
    logger.info("using the inline job driver (no Redis): schedules will not fire.");
    // Detached on purpose: in a dev server the handler must not run inside
    // the request that enqueued it. A test that wants to await the handler
    // passes its own `createInlineJobDriver({ await: true })` instance.
    return createInlineJobDriver({ logger, await: false });
  }

  if (!redisUrl) {
    logger.error(`${knob(choice, source)} needs REDIS_URL; jobs are disabled.`);
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
