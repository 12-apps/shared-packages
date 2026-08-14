// @vitest-environment node
/**
 * EVERY PUBLISHED ENTRY POINT, against every guard.
 *
 * A guard that lives on the newest factory protects the newest factory. The
 * documented adoption path is not always that one — this package's own
 * ADOPTING table names five importable surfaces, and the runtime root is the
 * one a host reaches for when it mounts the queue by hand.
 *
 * So this suite reads the `exports` map out of `package.json` rather than a
 * hand-kept list (a second copy would rot in the direction of not looking),
 * pins the set so a NEW subpath cannot arrive unreviewed, and then walks each
 * one to the hazard behind it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearJobs,
  defineJob,
  InvalidJobDefinitionError,
  NoJobsRegisteredError,
} from "../core/registry";
import { configureJobs, enqueueJob, resetJobRuntime, startJobWorkers } from "../core/runtime";
import { InvalidJobRetentionError } from "../core/retention";
import { createBullMqJobDriver } from "../drivers/bullmq";
import { createInlineJobDriver } from "../drivers/inline";
import { jobsRouter } from "../hono/index";
import { JobsConfigError } from "../server/config";
import { createApiJobs } from "../server/create-api-jobs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

afterEach(() => {
  resetJobRuntime();
  clearJobs();
  vi.unstubAllEnvs();
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/* eslint-disable test-flakiness/no-unmocked-fs --
   the manifest on disk IS the subject: this asserts what npm publishes as an
   entry point, and a mocked file system would assert a property of the mock. */
function publishedSubpaths(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
  ) as { exports: Record<string, string> };
  return Object.keys(manifest.exports).sort();
}
/* eslint-enable test-flakiness/no-unmocked-fs */

describe("the published entry points", () => {
  it("are exactly these five, plus the manifest", () => {
    // Pinned, so adding a subpath is a deliberate act that lands in this diff
    // together with whatever guard the new surface needs.
    expect(publishedSubpaths()).toEqual([
      ".",
      "./bullmq",
      "./hono",
      "./inline",
      "./package.json",
      "./server",
    ]);
  });
});

describe("`.` — the runtime root", () => {
  // The root is a first-class adoption path, not the factory's plumbing. Each
  // of the three refusals is reachable from it and fires from it.

  it("refuses a definition that could never run", () => {
    expect(() =>
      defineJob({ name: "root.blank", schedule: { pattern: "" }, handle: async () => undefined }),
    ).toThrow(InvalidJobDefinitionError);
  });

  it("refuses a worker with an empty registry", async () => {
    configureJobs({ driver: createInlineJobDriver({ logger: silentLogger() }) });

    await expect(startJobWorkers()).rejects.toThrow(NoJobsRegisteredError);
  });

  it("refuses an enqueue the execution side would refuse", async () => {
    const enqueue = vi.fn().mockResolvedValue({ enqueued: true });
    configureJobs({
      logger: silentLogger(),
      driver: {
        kind: "spy",
        enqueue,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
    });

    await expect(
      enqueueJob({ name: "root.ghost", handle: () => Promise.resolve() }, null, {}),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("`./server` — the factory", () => {
  it("refuses an empty `jobs` at assembly", () => {
    expect(() => createApiJobs({ jobs: [], logger: silentLogger() })).toThrow(
      JobsConfigError,
    );
  });

  it("refuses a thunk that registers nothing, at start()", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const api = createApiJobs({ jobs: () => undefined, logger: silentLogger() });

    await expect(api.start()).rejects.toThrow(NoJobsRegisteredError);
  });
});

describe("`./hono` — the adapter", () => {
  it("takes a built api, so it cannot construct an unguarded one", async () => {
    // The adapter's whole surface is `{ routes }`. It has no path to the
    // config, which is what keeps the assembly guard un-bypassable from here:
    // a router that built its own api would also answer for a runtime nobody
    // started.
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const job = defineJob({ name: "hono.declared", handle: async () => undefined });
    const api = createApiJobs({ jobs: [job], logger: silentLogger() });

    const response = await jobsRouter({ routes: api.routes }).request("/health");

    // Never started: degraded, not a green probe over an unconfigured runtime.
    expect(response.status).toBe(503);
  });
});

describe("`./bullmq` — the production driver, imported directly", () => {
  it("refuses an unbounded retention window, without going through the factory", () => {
    // `createApiJobs` checks this at assembly, but `./bullmq` is a published
    // entry point: a host that builds the driver itself must not be the path
    // that reaches BullMQ with a NaN or negative window. The guard sits at the
    // funnel both callers cross, not on the newest one.
    expect(() =>
      createBullMqJobDriver({
        redisUrl: "redis://127.0.0.1:6379",
        logger: silentLogger(),
        retention: {
          completed: { ageSeconds: 86_400, count: -1 },
          failed: { ageSeconds: 604_800, count: 5_000 },
        },
      }),
    ).toThrow(InvalidJobRetentionError);
  });

  it("refuses to write an unregistered job to the backend", async () => {
    // The gate at the other end of the wire. A host that builds the driver
    // itself skips `enqueueJob`, and without this the name would sit in Redis
    // until a consumer dead-lettered it. No connection is opened: the refusal
    // returns before any queue is constructed.
    const logger = silentLogger();
    const driver = createBullMqJobDriver({
      redisUrl: "redis://127.0.0.1:6379",
      logger,
    });

    await expect(
      driver.enqueue({ name: "bullmq.ghost", handle: () => Promise.resolve() }, {}, {}),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('refused to enqueue "bullmq.ghost"'),
    );

    await driver.stop();
  });
});

describe("`./inline` — the test and dev driver, imported directly", () => {
  it("is below the gate on purpose, and the runtime gate is in front of it", async () => {
    // The inline driver resolves no name: it runs the definition OBJECT it was
    // handed, so it has no write/run pair of its own to keep in step. Calling
    // it directly is how a test drives a handler, and must keep working.
    const driver = createInlineJobDriver({ logger: silentLogger() });
    const ran: string[] = [];

    await driver.enqueue(
      {
        name: "inline.direct",
        handle: () => {
          ran.push("direct");
          return Promise.resolve();
        },
      },
      undefined,
      {},
    );
    expect(ran).toEqual(["direct"]);

    // Through the runtime, the same unregistered definition never reaches it.
    configureJobs({ driver, logger: silentLogger() });
    await expect(
      enqueueJob(
        {
          name: "inline.direct",
          handle: () => {
            ran.push("through-runtime");
            return Promise.resolve();
          },
        },
        undefined,
        {},
      ),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(ran).toEqual(["direct"]);
  });
});
