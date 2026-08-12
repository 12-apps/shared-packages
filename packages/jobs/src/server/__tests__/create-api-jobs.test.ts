import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { clearJobs, defineJob } from "../../core/registry";
import { resetJobRuntime } from "../../core/runtime";
import type { JobDriver, JobLogger } from "../../core/types";
import { createInlineJobDriver } from "../../drivers/inline";
import type { SweepLeaseDb } from "../../lease/sweep-lease";
import type { JobsDriverChoice } from "../config";
import { createApiJobs } from "../create-api-jobs";

/**
 * The factory over the process-wide runtime: driver RESOLUTION (the zero-config
 * inline default, the production refusals), the worker switch, and the health
 * endpoint that reports whichever of those happened.
 *
 * The runtime and registry are module-level singletons — that is the design,
 * one driver per process — so every test resets both, and env expectations go
 * through `vi.stubEnv` rather than assignment.
 */

afterEach(() => {
  resetJobRuntime();
  clearJobs();
  vi.unstubAllEnvs();
});

/** A logger that records instead of printing — fresh mocks per test. */
function makeLogger(): { logger: JobLogger; info: Mock; error: Mock } {
  const info = vi.fn();
  const error = vi.fn();
  return { info, error, logger: { info, warn: vi.fn(), error } };
}

/** Everything a mock logger method was told, as one searchable string. */
function loggedText(mock: Mock): string {
  return mock.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

/** No REDIS_URL, non-production — the zero-config developer environment. */
function stubBareEnv(): void {
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("JOBS_DRIVER", "");
  vi.stubEnv("JOBS_WORKER", "");
  vi.stubEnv("NODE_ENV", "development");
}

async function healthOf(api: { routes: { path: string; handle(): Promise<{ status: number; body: unknown }> }[] }) {
  const route = api.routes.find((candidate) => candidate.path === "/health");
  if (!route) throw new Error("no /health route");
  const response = await route.handle();
  return { status: response.status, body: response.body as { status: string; checks: Record<string, unknown> } };
}

describe("createApiJobs — driver resolution", () => {
  it("defaults to the inline driver with no Redis and no config (zero-config dev)", async () => {
    stubBareEnv();
    const { logger, info } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.checks.driver).toBe("inline");
    expect(loggedText(info)).toContain("inline job driver");
  });

  it("runs an enqueued handler in-process under the zero-config default", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    // The resolved inline driver is detached (a dev server must not run work
    // inside the request that enqueued it), so the proof is a promise the
    // handler itself resolves.
    const gate: { open?: (value: string) => void } = {};
    const handled = new Promise<string>((resolve) => {
      gate.open = resolve;
    });
    const job = defineJob<{ id: string }>({
      name: "test.echo",
      handle: async ({ id }) => {
        gate.open?.(id);
      },
    });
    const api = createApiJobs({ jobs: [job], logger });
    await api.start();

    const result = await job.enqueue({ id: "abc" });

    expect(result.enqueued).toBe(true);
    await expect(handled).resolves.toBe("abc");
  });

  it("disables jobs in production when nothing is configured, and says so", async () => {
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, production: true });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.driver).toBeNull();
    expect(loggedText(error)).toContain("Set REDIS_URL");
  });

  it("refuses the inline driver in production, naming the config knob", async () => {
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, production: true, driver: "inline" });

    await api.start();

    const { status } = await healthOf(api);
    expect(status).toBe(503);
    // The message names WHERE the choice came from: an operator reading a
    // JOBS_DRIVER message for a choice made in code would hunt for an env
    // var that is not set.
    expect(loggedText(error)).toContain(
      'createApiJobs({ driver: "inline" }) is refused in production',
    );
  });

  it("refuses JOBS_DRIVER=inline in production with future-pay's exact words", async () => {
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "inline");
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, production: true });

    await api.start();

    const { status } = await healthOf(api);
    expect(status).toBe(503);
    // Byte-identical to future-pay's runtime.ts — a host greps for this line.
    expect(loggedText(error)).toContain(
      "JOBS_DRIVER=inline is refused in production; jobs are disabled.",
    );
  });

  it("refuses an inline driver INSTANCE in production too", async () => {
    // The whole reason inline is refused (no retries, no schedules, work dies
    // with the request) applies identically to an instance — passing one must
    // not be the quiet way around the guard.
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      driver: createInlineJobDriver({ logger }),
      logger,
      production: true,
    });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.checks.driver).toBeNull();
    expect(loggedText(error)).toContain("refused in production");
  });

  it("treats an unrecognised JOBS_DRIVER as off, loudly", async () => {
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "rabbitmq");
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { status } = await healthOf(api);
    expect(status).toBe(503);
    expect(loggedText(error)).toContain('JOBS_DRIVER="rabbitmq"');
  });

  it("treats an unrecognised config.driver string as off, loudly", async () => {
    // The type forbids it, but a JS consumer can pass anything — this used to
    // fall through the validation and resolve to bullmq with no complaint.
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      logger,
      redisUrl: "redis://localhost:6379", // the silent-bullmq bait
      driver: "rabbitmq" as unknown as JobsDriverChoice,
    });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.checks.driver).toBeNull();
    expect(loggedText(error)).toContain(
      'createApiJobs({ driver: "rabbitmq" }) is not a driver; jobs are disabled.',
    );
  });

  it("needs a Redis URL for a bullmq choice, naming the knob that chose it", async () => {
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, driver: "bullmq" });

    await api.start();

    const { status } = await healthOf(api);
    expect(status).toBe(503);
    expect(loggedText(error)).toContain(
      'createApiJobs({ driver: "bullmq" }) needs REDIS_URL; jobs are disabled.',
    );
  });

  it("needs a Redis URL for JOBS_DRIVER=bullmq, with future-pay's exact words", async () => {
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "bullmq");
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { status } = await healthOf(api);
    expect(status).toBe(503);
    // Byte-identical to future-pay's runtime.ts — a host greps for this line.
    expect(loggedText(error)).toContain(
      "JOBS_DRIVER=bullmq needs REDIS_URL; jobs are disabled.",
    );
  });

  it("resolves bullmq from a configured Redis URL in a producer", async () => {
    // A producer never opens a connection (queues are created per enqueue),
    // so resolution is safe to pin without a Redis behind it.
    stubBareEnv();
    const { logger } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      logger,
      redisUrl: "redis://localhost:6379",
    });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.checks.driver).toBe("bullmq");
    expect(body.checks.worker).toBe(false);
    expect(body.checks.consuming).toBe(false);
  });

  it("uses a driver instance as-is", async () => {
    stubBareEnv();
    const driver: JobDriver = {
      kind: "custom",
      enqueue: async () => ({ enqueued: true }),
      start: async () => undefined,
      stop: async () => undefined,
    };
    const api = createApiJobs({ jobs: [], driver, logger: makeLogger().logger });

    await api.start();

    const { body } = await healthOf(api);
    expect(body.checks.driver).toBe("custom");
  });

  it("reads REDIS_URL at start(), not at factory time", async () => {
    // Reviewer probe E: future-pay's bootstrapJobs read the WHOLE matrix at
    // the moment it ran. The recommended host shape is factory-at-module-scope
    // + start() at process start, so an env var set between the two (a config
    // module loading after the module that built the api) must be honoured —
    // for every variable of the matrix, not just JOBS_DRIVER.
    stubBareEnv();
    const { logger } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    vi.stubEnv("REDIS_URL", "redis://localhost:6379"); // arrives late
    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.checks.driver).toBe("bullmq");
  });

  it("reads JOBS_WORKER at start(), not at factory time", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      driver: createInlineJobDriver({ logger }),
      logger,
      installShutdownHooks: false,
    });

    vi.stubEnv("JOBS_WORKER", "1"); // arrives late
    await api.start();

    const { body } = await healthOf(api);
    expect(body.checks.worker).toBe(true);
    expect(body.checks.consuming).toBe(true);
  });

  it("reads NODE_ENV at start(), so late-arriving production disables inline", async () => {
    // Reviewer probe F's counterpart: the same late-env scenario for the
    // production flag — dev-default inline must NOT win over an environment
    // that had become production by the time start() ran.
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    vi.stubEnv("NODE_ENV", "production"); // arrives late
    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.checks.driver).toBeNull();
    expect(loggedText(error)).toContain("Set REDIS_URL");
  });
});

describe("createApiJobs — worker mode and lifecycle", () => {
  it("consumes and installs schedules only when worker is set", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    const started: string[][] = [];
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: async (definitions) => {
        started.push(definitions.map((definition) => definition.name));
      },
      stop: async () => undefined,
    };
    defineJob({ name: "test.sweep", handle: async () => undefined });

    const api = createApiJobs({
      jobs: [],
      driver,
      logger,
      worker: true,
      installShutdownHooks: false,
    });
    await api.start();

    expect(started).toEqual([["test.sweep"]]);
    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.checks.consuming).toBe(true);
  });

  it("registers jobs through an import thunk before consuming", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    const started: number[] = [];
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: async (definitions) => {
        started.push(definitions.length);
      },
      stop: async () => undefined,
    };
    const api = createApiJobs({
      jobs: () => {
        defineJob({ name: "test.late", handle: async () => undefined });
      },
      driver,
      logger,
      worker: true,
      installShutdownHooks: false,
    });

    await api.start();

    expect(started).toEqual([1]);
  });

  it("reports degraded until start() runs, then ok, then degraded after stop()", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      driver: createInlineJobDriver({ logger }),
      logger,
      worker: true,
      installShutdownHooks: false,
    });

    expect((await healthOf(api)).status).toBe(503);

    await api.start();
    expect((await healthOf(api)).status).toBe(200);

    await api.stop();
    expect((await healthOf(api)).status).toBe(503);
  });

  it("is idempotent: a second start() does not double-consume", async () => {
    stubBareEnv();
    const { logger } = makeLogger();
    const starts: number[] = [];
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: async () => {
        starts.push(1);
      },
      stop: async () => undefined,
    };
    const api = createApiJobs({
      jobs: [],
      driver,
      logger,
      worker: true,
      installShutdownHooks: false,
    });

    await api.start();
    await api.start();

    expect(starts).toHaveLength(1);
  });

  it("reads the worker switch from JOBS_WORKER", async () => {
    stubBareEnv();
    vi.stubEnv("JOBS_WORKER", "1");
    const { logger } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      driver: createInlineJobDriver({ logger }),
      logger,
      installShutdownHooks: false,
    });

    await api.start();

    const { body } = await healthOf(api);
    expect(body.checks.worker).toBe(true);
    expect(body.checks.consuming).toBe(true);
  });

  it("stays degraded when start() threw — a failed boot must not probe green", async () => {
    // Reviewer probe A: the one case start() is documented to reject in (a
    // duplicate job name) previously left `started` latched true and the
    // health endpoint answering 200 over a runtime with no registered jobs.
    stubBareEnv();
    const { logger } = makeLogger();
    defineJob({ name: "test.dup", handle: async () => undefined });
    const api = createApiJobs({
      jobs: () => {
        defineJob({ name: "test.dup", handle: async () => undefined });
      },
      logger,
    });

    await expect(api.start()).rejects.toThrow(/already defined/);

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.configured).toBe(false);
    // And the latch holds: a retry is a no-op, exactly like future-pay's
    // `bootstrapped` flag — never a silent second bootstrap.
    await expect(api.start()).resolves.toBeUndefined();
  });

  it("lets a stop() that lands mid-start win — the start tail must not resurrect it", async () => {
    // Delta finding N3: moving `started = true` to the tail (the MAJOR-1 fix)
    // created a window where a stop() during `await driver.start()` was
    // overwritten by the start's continuation, leaving a stopped runtime
    // advertising consuming:true. A deferred driver.start makes the
    // interleaving deterministic.
    stubBareEnv();
    const { logger } = makeLogger();
    const gate: { open?: () => void } = {};
    const startGate = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: () => startGate,
      stop: async () => undefined,
    };
    const api = createApiJobs({
      jobs: [],
      driver,
      logger,
      worker: true,
      installShutdownHooks: false,
    });

    const starting = api.start(); // parks inside driver.start()
    await api.stop(); // lands first
    gate.open?.(); // now let the start continue to its tail
    await starting;

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.checks.configured).toBe(false);
    expect(body.checks.consuming).toBe(false);
  });

  it("does not stack drain hooks across stop()/start() cycles", async () => {
    // Reviewer finding MINOR-9: hooks were installed per successful worker
    // start, so a stop()/start() cycle left two process.once pairs and one
    // real signal would have drained the driver twice.
    stubBareEnv();
    const { logger } = makeLogger();
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: async () => undefined,
      stop: async () => undefined,
    };
    const listenersBefore = {
      SIGTERM: new Set(process.listeners("SIGTERM")),
      SIGINT: new Set(process.listeners("SIGINT")),
    };
    const api = createApiJobs({ jobs: [], driver, logger, worker: true });
    try {
      await api.start();
      await api.stop();
      await api.start();

      const added = process
        .listeners("SIGTERM")
        .filter((listener) => !listenersBefore.SIGTERM.has(listener));
      expect(added).toHaveLength(1);
    } finally {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        for (const listener of process.listeners(signal)) {
          if (!listenersBefore[signal].has(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
    }
  });

  it("stops reporting a drained worker as consuming when the signal hook fires", async () => {
    // Reviewer probe B: the SIGTERM hook drained the driver but never touched
    // the instance state, so /health kept advertising a stopped worker as a
    // healthy consumer — the exact field a rolling deploy keys on.
    stubBareEnv();
    const { logger } = makeLogger();
    const stops: number[] = [];
    const driver: JobDriver = {
      kind: "recording",
      enqueue: async () => ({ enqueued: true }),
      start: async () => undefined,
      stop: async () => {
        stops.push(1);
      },
    };
    const listenersBefore = {
      SIGTERM: new Set(process.listeners("SIGTERM")),
      SIGINT: new Set(process.listeners("SIGINT")),
    };
    const api = createApiJobs({ jobs: [], driver, logger, worker: true });
    try {
      await api.start();
      const added = process
        .listeners("SIGTERM")
        .filter((listener) => !listenersBefore.SIGTERM.has(listener));
      expect(added).toHaveLength(1);

      // Deliver the signal to OUR hook only — emitting a real SIGTERM would
      // also reach the test runner's own handlers.
      (added[0] as () => void)();

      const { status, body } = await healthOf(api);
      expect(status).toBe(503);
      expect(body.checks.consuming).toBe(false);
      await vi.waitFor(() => expect(stops).toHaveLength(1));
    } finally {
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        for (const listener of process.listeners(signal)) {
          if (!listenersBefore[signal].has(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
    }
  });
});

describe("createApiJobs — the sweep lease seam", () => {
  it("binds withSweepLease to the configured db", async () => {
    stubBareEnv();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = (): Promise<SweepLeaseDb> =>
      Promise.resolve({ sweepLease: { updateMany, create: vi.fn() } });
    const api = createApiJobs({ jobs: [], logger: makeLogger().logger, db });

    const outcome = await api.withSweepLease("test.sweep", 60_000, async () => "ran");

    expect(outcome).toEqual({ ran: true, result: "ran" });
    expect(updateMany).toHaveBeenCalled();
  });

  it("rejects — never silently skips — when no db was configured", async () => {
    stubBareEnv();
    const api = createApiJobs({ jobs: [], logger: makeLogger().logger });

    // A sweep whose lease quietly no-ops is the unprotected overlap the lease
    // exists to prevent; misconfiguration must surface as a failed job — and
    // as a REJECTION, because the type promises a Promise: a synchronous
    // throw would escape .catch(), Promise.all, and any caller that collects
    // the promise before awaiting it.
    await expect(
      api.withSweepLease("test.sweep", 60_000, async () => "x"),
    ).rejects.toThrow(/db/);
  });
});

describe("createApiJobs — health payload", () => {
  it('reports an explicit driver:"off" as disabled (200), not degraded forever', async () => {
    // `off` is a first-class value of the matrix — a review box or CI that
    // genuinely wants no queue. A permanent 503 would make any readiness
    // aggregate that folds this endpoint in unable to ever go green.
    stubBareEnv();
    const { logger } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, driver: "off" });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.status).toBe("disabled");
    expect(body.checks.driver).toBeNull();
  });

  it("reports an explicit JOBS_DRIVER=off as disabled too", async () => {
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "off");
    const { logger } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(200);
    expect(body.status).toBe("disabled");
  });

  it("keeps off-by-misconfiguration degraded — only a CHOICE reads as disabled", async () => {
    // Production with nothing configured RESOLVES to off, but nobody chose
    // it; that is the broken state the 503 exists for. (The explicit-off
    // production case still logs future-pay's error line either way.)
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "rabbitmq");
    const { logger } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
  });

  it("keeps an explicit JOBS_DRIVER=off in PRODUCTION degraded, with the error line", async () => {
    // Delta finding N1: "deliberate" only counts outside production. In
    // production, explicit off and nothing-configured are the same fact —
    // no queue where one is expected (JOBS_DRIVER=off arrives via a shared
    // env template or a promoted staging config) — and the probe must report
    // what the log line said, 503 for both, not green-light one of them.
    stubBareEnv();
    vi.stubEnv("JOBS_DRIVER", "off");
    const { logger, error } = makeLogger();
    const api = createApiJobs({ jobs: [], logger, production: true });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(loggedText(error)).toContain(
      "No job driver: scheduled work will NOT run in this deployment. Set REDIS_URL.",
    );
  });

  it("treats a driver that is neither a string nor an instance as off, loudly", async () => {
    // Delta finding N5: 42 / true / null used to fall through both validation
    // guards and land on the env matrix as if nothing had been said.
    stubBareEnv();
    const { logger, error } = makeLogger();
    const api = createApiJobs({
      jobs: [],
      logger,
      driver: 42 as unknown as JobsDriverChoice,
    });

    await api.start();

    const { status, body } = await healthOf(api);
    expect(status).toBe(503);
    expect(body.checks.driver).toBeNull();
    expect(loggedText(error)).toContain(
      "createApiJobs({ driver: 42 }) is not a driver; jobs are disabled.",
    );
  });

  it("counts registered jobs and schedules", async () => {
    stubBareEnv();
    defineJob({ name: "test.plain", handle: async () => undefined });
    defineJob({
      name: "test.cron",
      schedule: { pattern: "0 * * * *" },
      handle: async () => undefined,
    });
    const { logger } = makeLogger();
    const api = createApiJobs({ jobs: [], logger });

    await api.start();

    const { body } = await healthOf(api);
    expect(body.checks.jobs).toBe(2);
    expect(body.checks.schedules).toBe(1);
  });
});
