import { afterEach, describe, expect, it, vi } from "vitest";

import { createInlineJobDriver } from "../../drivers/inline";
import {
  clearJobs,
  defineJob,
  DuplicateJobError,
  findJob,
  InvalidJobDefinitionError,
  listJobs,
  NoJobsRegisteredError,
  resolveRegisteredJob,
} from "../registry";
import { configureJobs, enqueueJob, resetJobRuntime, startJobWorkers } from "../runtime";

afterEach(() => {
  clearJobs();
  resetJobRuntime();
});

describe("defineJob", () => {
  it("registers the definition under its name", () => {
    const job = defineJob({ name: "a.job", handle: () => Promise.resolve() });

    expect(job.name).toBe("a.job");
    expect(findJob("a.job")).toBe(job.definition);
    expect(listJobs()).toHaveLength(1);
  });

  it("refuses a duplicate name rather than replacing the handler", () => {
    defineJob({ name: "a.job", handle: () => Promise.resolve() });

    expect(() => defineJob({ name: "a.job", handle: () => Promise.resolve() })).toThrow(
      DuplicateJobError,
    );
  });
});

describe("defineJob — refusing what would fail silently", () => {
  // Every case here type-checks today and produces a job that quietly does
  // nothing: an unnamed wire key, a queue nobody consumes, a scheduler that
  // never fires. None of them fails at runtime, which is why they are refused
  // where the declaration is written.

  it("refuses a blank name", () => {
    expect(() => defineJob({ name: "  ", handle: () => Promise.resolve() })).toThrow(
      InvalidJobDefinitionError,
    );
  });

  it("refuses a handler that is not a function", () => {
    expect(() =>
      defineJob({ name: "a.job", handle: undefined as unknown as () => Promise<void> }),
    ).toThrow(/`handle` must be a function/);
  });

  it("refuses an empty queue name, which never falls back to the default", () => {
    // `queue: ""` is not nullish, so `queue ?? DEFAULT_QUEUE` keeps it: the job
    // lands on a queue named "" that no worker is ever started for.
    expect(() =>
      defineJob({ name: "a.job", queue: "", handle: () => Promise.resolve() }),
    ).toThrow(/`queue` must be a non-empty string/);
  });

  it("refuses a cron pattern that no scheduler will fire", () => {
    for (const pattern of ["", "   ", "@daily", "0 *"]) {
      expect(() =>
        defineJob({
          name: `cron.${pattern.trim() || "blank"}`,
          schedule: { pattern },
          handle: () => Promise.resolve(),
        }),
      ).toThrow(InvalidJobDefinitionError);
    }
  });

  it("accepts 5- and 6-field patterns, and a named timezone", () => {
    expect(() =>
      defineJob({
        name: "cron.five",
        schedule: { pattern: "*/5 * * * *", timezone: "Pacific/Honolulu" },
        handle: () => Promise.resolve(),
      }),
    ).not.toThrow();
    expect(() =>
      defineJob({
        name: "cron.six",
        schedule: { pattern: "0 */5 * * * *" },
        handle: () => Promise.resolve(),
      }),
    ).not.toThrow();
  });

  it("refuses non-positive attempts and concurrency", () => {
    expect(() =>
      defineJob({ name: "a.job", attempts: 0, handle: () => Promise.resolve() }),
    ).toThrow(/`attempts` must be a positive integer/);
    expect(() =>
      defineJob({ name: "b.job", concurrency: 0, handle: () => Promise.resolve() }),
    ).toThrow(/`concurrency` must be a positive integer/);
  });

  it("refuses a backoff with no usable delay or an unknown type", () => {
    expect(() =>
      defineJob({
        name: "a.job",
        backoff: { type: "exponential", delayMs: 0 },
        handle: () => Promise.resolve(),
      }),
    ).toThrow(/`backoff.delayMs`/);
    expect(() =>
      defineJob({
        name: "b.job",
        backoff: { type: "linear" as "fixed", delayMs: 100 },
        handle: () => Promise.resolve(),
      }),
    ).toThrow(/`backoff.type`/);
  });

  it("leaves nothing registered when it refuses", () => {
    expect(() => defineJob({ name: "", handle: () => Promise.resolve() })).toThrow();
    expect(listJobs()).toHaveLength(0);
  });
});

describe("resolveRegisteredJob — the gate both sides ask", () => {
  it("answers with the registered definition, by name or by identity", () => {
    const job = defineJob({ name: "a.job", handle: () => Promise.resolve() });

    expect(resolveRegisteredJob("a.job")).toBe(job.definition);
    expect(resolveRegisteredJob(job.definition)).toBe(job.definition);
  });

  it("refuses an impostor carrying a registered name", () => {
    // Same name, different object: it would ship a payload the real handler
    // never agreed to, and it is not the object a worker holds.
    defineJob({ name: "a.job", handle: () => Promise.resolve() });

    expect(
      resolveRegisteredJob({ name: "a.job", handle: () => Promise.resolve() }),
    ).toBeUndefined();
  });

  it("refuses a name nothing registered", () => {
    expect(resolveRegisteredJob("never.defined")).toBeUndefined();
  });
});

describe("enqueue", () => {
  it("runs the handler through the installed driver", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const job = defineJob<{ id: string }>({ name: "a.job", handle });
    configureJobs({ driver: createInlineJobDriver({ logger: silentLogger() }) });

    const result = await job.enqueue({ id: "x" });

    expect(result).toEqual({ enqueued: true });
    expect(handle).toHaveBeenCalledWith(
      { id: "x" },
      expect.objectContaining({ attempt: 1, maxAttempts: 1 }),
    );
  });

  it("reports rather than throws when no driver is configured", async () => {
    const job = defineJob({ name: "a.job", handle: () => Promise.resolve() });

    await expect(job.enqueue()).resolves.toEqual({
      enqueued: false,
      reason: "no-driver",
    });
  });

  it("reports rather than throws when the driver itself fails", async () => {
    // The definition is REGISTERED here (it was a bare object literal before
    // the gate existed): this case is about a backend fault, so it has to
    // reach the driver to produce one.
    const job = defineJob({ name: "a.job", handle: () => Promise.resolve() });
    configureJobs({
      logger: silentLogger(),
      driver: {
        kind: "broken",
        enqueue: () => Promise.reject(new Error("redis is down")),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
    });

    await expect(enqueueJob(job.definition, undefined, {})).resolves.toEqual({
      enqueued: false,
      reason: "error",
    });
  });

  it("refuses a definition the registry does not hold, before the driver sees it", async () => {
    // The write/run asymmetry this closes: the backend accepted the job, the
    // consumer found no handler for the name, the run dead-lettered — and the
    // caller had been told `enqueued: true`.
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
      enqueueJob({ name: "ghost.job", handle: () => Promise.resolve() }, undefined, {}),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an impostor sharing a registered name", async () => {
    defineJob({ name: "a.job", handle: () => Promise.resolve() });
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
      enqueueJob({ name: "a.job", handle: () => Promise.resolve() }, { spoofed: true }, {}),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("startJobWorkers", () => {
  it("starts every registered job once, ignoring a second call", async () => {
    defineJob({ name: "a.job", handle: () => Promise.resolve() });
    const start = vi.fn().mockResolvedValue(undefined);
    configureJobs({
      logger: silentLogger(),
      driver: {
        kind: "spy",
        enqueue: () => Promise.resolve({ enqueued: true }),
        start,
        stop: () => Promise.resolve(),
      },
    });

    await startJobWorkers();
    await startJobWorkers();

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("refuses to start with no driver configured", async () => {
    defineJob({ name: "a.job", handle: () => Promise.resolve() });

    await expect(startJobWorkers()).rejects.toThrow("no driver configured");
  });

  it("refuses to start with an EMPTY registry", async () => {
    // The guard lives here, on the root entry point, and not only on the
    // server factory: a worker consuming nothing installs no schedule, reads
    // no queue, and reports itself started. Every sweep in the deployment
    // stops, with nothing failed to show it.
    const start = vi.fn().mockResolvedValue(undefined);
    configureJobs({
      logger: silentLogger(),
      driver: {
        kind: "spy",
        enqueue: () => Promise.resolve({ enqueued: true }),
        start,
        stop: () => Promise.resolve(),
      },
    });

    await expect(startJobWorkers()).rejects.toThrow(NoJobsRegisteredError);
    expect(start).not.toHaveBeenCalled();
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
