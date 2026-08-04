import { afterEach, describe, expect, it, vi } from "vitest";

import { createInlineJobDriver } from "../../drivers/inline";
import { clearJobs, defineJob, DuplicateJobError, findJob, listJobs } from "../registry";
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
    const definition = { name: "a.job", handle: () => Promise.resolve() };
    configureJobs({
      logger: silentLogger(),
      driver: {
        kind: "broken",
        enqueue: () => Promise.reject(new Error("redis is down")),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
    });

    await expect(enqueueJob(definition, undefined, {})).resolves.toEqual({
      enqueued: false,
      reason: "error",
    });
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
    await expect(startJobWorkers()).rejects.toThrow("no driver configured");
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
