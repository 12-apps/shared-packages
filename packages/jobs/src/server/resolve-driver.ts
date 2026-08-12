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

/** The allow-list. Anything else is a misconfiguration, never a guess. */
function asChoice(value: string): JobsDriverChoice | null {
  return value === "bullmq" || value === "inline" || value === "off" ? value : null;
}

function resolveChoice(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): DriverChoice {
  if (typeof config.driver === "string") {
    const named = asChoice(config.driver.trim().toLowerCase());
    if (named) return { choice: named, source: "config" };
    // The type forbids this, but a JS consumer can pass anything — and the
    // env path validates, so the config path must too: same value, same
    // loud-and-off outcome, never a silent fallthrough to bullmq.
    resolved.logger.error(
      `createApiJobs({ driver: "${config.driver}" }) is not a driver; jobs are disabled.`,
    );
    return { choice: "off", source: "default" };
  }
  const configured = process.env.JOBS_DRIVER?.trim().toLowerCase();
  if (configured) {
    const named = asChoice(configured);
    if (named) return { choice: named, source: "env" };
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
 * What resolution decided, and whether "no driver" was a deliberate choice.
 * Not exported: `createApiJobs` destructures it, and an exported type nothing
 * imports is exactly what the knip gate is there to stop.
 */
interface DriverResolution {
  driver: JobDriver | null;
  /**
   * True only for an EXPLICIT `off` — `JOBS_DRIVER=off` or
   * `createApiJobs({ driver: "off" })`: a review box or a CI environment
   * that genuinely wants no queue. False for every misconfiguration that
   * merely RESOLVES to off, so health can tell "disabled by choice" apart
   * from "broken".
   */
  deliberatelyOff: boolean;
}

const off = (deliberatelyOff: boolean): DriverResolution => ({
  driver: null,
  deliberatelyOff,
});

/**
 * An instance passed in is the host's own decision — for anything except the
 * inline driver in production, which is refused for exactly the reason the
 * NAMED choice is: no retries, no schedules, and work that dies with the
 * request that enqueued it. An instance must not be the quiet way around
 * that guard.
 */
function resolveInstance(driver: JobDriver, resolved: ResolvedConfig): DriverResolution {
  if (resolved.production && driver.kind === "inline") {
    resolved.logger.error(
      "an inline driver instance is refused in production; jobs are disabled.",
    );
    return off(false);
  }
  return { driver, deliberatelyOff: false };
}

/** The bullmq branch: a Redis URL is required, and the import stays lazy. */
async function resolveBullMq(
  choice: DriverChoice,
  resolved: ResolvedConfig,
): Promise<DriverResolution> {
  const { logger, redisUrl } = resolved;
  if (!redisUrl) {
    logger.error(`${knob(choice.choice, choice.source)} needs REDIS_URL; jobs are disabled.`);
    return off(false);
  }
  try {
    // Imported lazily so `bullmq` (and ioredis) are pulled in only by a
    // process that actually talks to Redis — never into a bundle that only
    // enqueues. The specifier is a literal, which is what keeps it loadable
    // once the host bundles this package's published TS source.
    const { createBullMqJobDriver } = await import("../drivers/bullmq");
    return {
      driver: createBullMqJobDriver({ redisUrl, logger, prefix: resolved.queuePrefix }),
      deliberatelyOff: false,
    };
  } catch (error) {
    logger.error("could not create the BullMQ driver; jobs are disabled:", error);
    return off(false);
  }
}

/**
 * Pick the driver, or NULL for "jobs are disabled in this process" — which is
 * always accompanied by a loud log line, never silent, unless it was a
 * deliberate `off`.
 */
export async function resolveDriver(
  config: JobsServerConfig,
  resolved: ResolvedConfig,
): Promise<DriverResolution> {
  const { logger, production } = resolved;

  if (config.driver && typeof config.driver === "object") {
    return resolveInstance(config.driver, resolved);
  }

  const named = resolveChoice(config, resolved);
  const { choice, source } = named;

  if (choice === "off") {
    if (production) {
      // Logged in production even for an explicit off — byte-identical to
      // future-pay's runtime.ts. The health endpoint is what distinguishes
      // the deliberate case; the log line stays because production with no
      // queue is worth a line in the log either way.
      logger.error(
        "No job driver: scheduled work will NOT run in this deployment. Set REDIS_URL.",
      );
    }
    return off(source !== "default");
  }

  if (choice === "inline") {
    if (production) {
      // Inline runs the handler inside whatever request enqueued it and has
      // no retries and no schedules. That is a development convenience, and
      // in production it would silently drop work a crash interrupts.
      logger.error(`${knob(choice, source)} is refused in production; jobs are disabled.`);
      return off(false);
    }
    logger.info("using the inline job driver (no Redis): schedules will not fire.");
    // Detached on purpose: in a dev server the handler must not run inside
    // the request that enqueued it. A test that wants to await the handler
    // passes its own `createInlineJobDriver({ await: true })` instance.
    return { driver: createInlineJobDriver({ logger, await: false }), deliberatelyOff: false };
  }

  return resolveBullMq(named, resolved);
}
