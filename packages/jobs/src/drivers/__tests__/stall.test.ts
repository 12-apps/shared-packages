import { describe, expect, it, vi } from "vitest";

import {
  assertValidStall,
  DEFAULT_STALL_POLICY,
  InvalidJobStallError,
  resolveStallPolicy,
} from "../../core/stall";
import type { AnyJobDefinition, JobEvents, JobLogger, JobStalledEvent } from "../../core/types";
import { __testables } from "../bullmq";

/**
 * FUT-2480: the `sweeps` worker lost its lock whenever its event loop stalled
 * past BullMQ's implicit 30 s, and nothing in this package named the numbers
 * or reported the stall itself. These pin the three things that fix is made
 * of: the settings, the bound on re-runs a scheduled job never had, and the
 * report of each stall.
 */
const { maxStartedAttemptsFor, reportStall } = __testables;

function job(overrides: Partial<AnyJobDefinition> = {}): AnyJobDefinition {
  return { name: "a.job", handle: () => Promise.resolve(), ...overrides };
}

function recordingLogger(): JobLogger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => {
      errors.push(message);
    },
  };
}

describe("resolveStallPolicy", () => {
  it("is BullMQ's own defaults when the host says nothing", () => {
    expect(resolveStallPolicy("sweeps", undefined)).toEqual({
      lockDurationMs: 30_000,
      stalledIntervalMs: 30_000,
      maxStalledCount: 1,
    });
    expect(DEFAULT_STALL_POLICY).toEqual(resolveStallPolicy("any", {}));
  });

  it("lays the per-queue values over the host-wide ones, field by field", () => {
    const stall = {
      stalledIntervalMs: 15_000,
      queues: { sweeps: { lockDurationMs: 90_000 } },
    };
    expect(resolveStallPolicy("sweeps", stall)).toEqual({
      lockDurationMs: 90_000,
      stalledIntervalMs: 15_000,
      maxStalledCount: 1,
    });
    // Another queue gets the host-wide value and nothing of the sweeps' lock.
    expect(resolveStallPolicy("default", stall)).toEqual({
      lockDurationMs: 30_000,
      stalledIntervalMs: 15_000,
      maxStalledCount: 1,
    });
  });

  it("keeps a stated 0 re-runs rather than falling back to the default", () => {
    expect(resolveStallPolicy("q", { maxStalledCount: 0 }).maxStalledCount).toBe(0);
  });
});

describe("assertValidStall", () => {
  it("accepts nothing, and accepts sane values", () => {
    expect(() => assertValidStall(undefined)).not.toThrow();
    expect(() =>
      assertValidStall({ lockDurationMs: 60_000, queues: { sweeps: { maxStalledCount: 0 } } }),
    ).not.toThrow();
  });

  it("refuses a lock of 0 or NaN, which would expire the moment it was taken", () => {
    expect(() => assertValidStall({ lockDurationMs: 0 })).toThrow(InvalidJobStallError);
    expect(() => assertValidStall({ lockDurationMs: Number.NaN })).toThrow(/lockDurationMs/);
  });

  it("refuses a negative or fractional re-run count, and names the queue", () => {
    expect(() => assertValidStall({ maxStalledCount: -1 })).toThrow(InvalidJobStallError);
    expect(() => assertValidStall({ queues: { sweeps: { maxStalledCount: 1.5 } } })).toThrow(
      /queues\.sweeps\.maxStalledCount/,
    );
  });

  it("refuses a stalled interval that is not a positive integer", () => {
    expect(() => assertValidStall({ stalledIntervalMs: -5 })).toThrow(/stalledIntervalMs/);
  });
});

describe("maxStartedAttemptsFor", () => {
  it("allows every attempt plus every stall re-run", () => {
    // A single-attempt sweep that may recover from one stall: two starts,
    // and the third is failed as a dead-letter instead of looping forever.
    expect(maxStartedAttemptsFor([job({ attempts: 1 })], 1)).toBe(2);
  });

  it("takes the largest attempt budget on the queue, so no job is cut short", () => {
    expect(
      maxStartedAttemptsFor([job({ attempts: 1 }), job({ name: "b.job", attempts: 3 })], 1),
    ).toBe(4);
  });

  it("treats an unstated attempt budget as one attempt", () => {
    expect(maxStartedAttemptsFor([job()], 0)).toBe(1);
  });
});

describe("reportStall", () => {
  it("logs an ERROR naming the job, the run and the attempt, and tells the host", async () => {
    const logger = recordingLogger();
    const seen: JobStalledEvent[] = [];
    const events: JobEvents = { onJobStalled: (event) => void seen.push(event) };
    const emit = (fn: (events: JobEvents) => void | Promise<void>) => void fn(events);

    await reportStall({ logger, emit }, "sweeps", "repeat:kitchen-print.sweep:1790260740000", () =>
      Promise.resolve({
        name: "kitchen-print.sweep",
        attemptsStarted: 1,
        stalledCounter: 1,
        opts: { attempts: 1 },
        repeatJobKey: "kitchen-print.sweep",
      }),
      1,
    );

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('job "kitchen-print.sweep" on queue "sweeps" stalled');
    expect(logger.errors[0]).toContain("run repeat:kitchen-print.sweep:1790260740000");
    expect(logger.errors[0]).toContain("started 1 time(s) of 1 attempt(s), stalled 1 time(s)");
    expect(logger.errors[0]).toContain("will run again");
    expect(seen).toEqual([
      {
        name: "kitchen-print.sweep",
        queue: "sweeps",
        runId: "repeat:kitchen-print.sweep:1790260740000",
        startedCount: 1,
        maxAttempts: 1,
        stalledCount: 1,
      },
    ]);
  });

  it("still reports the stall, by id, when the job cannot be read back", async () => {
    // The job may already be trimmed, or Redis may not answer: the stall
    // happened either way, and a report that depended on the read would drop
    // exactly the incidents where Redis was the problem.
    const logger = recordingLogger();
    const onJobStalled = vi.fn();
    const emit = (fn: (events: JobEvents) => void | Promise<void>) => void fn({ onJobStalled });

    await reportStall(
      { logger, emit },
      "sweeps",
      "job-42",
      () => Promise.reject(new Error("connection is closed")),
      1,
    );

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain("run job-42");
    expect(onJobStalled).toHaveBeenCalledWith(
      expect.objectContaining({ name: undefined, queue: "sweeps", runId: "job-42" }),
    );
  });
});

describe("reportStall, over the stall budget", () => {
  const silentEmit = () => undefined;

  it("says a one-off job over its budget is failed as a dead-letter, not re-run", async () => {
    const logger = recordingLogger();
    await reportStall({ logger, emit: silentEmit }, "oneshot", "1", () =>
      Promise.resolve({ name: "a.job", attemptsStarted: 2, stalledCounter: 1, opts: { attempts: 3 } }),
      0,
    );
    expect(logger.errors[0]).toContain("stalled more than the 0 time(s) allowed");
    expect(logger.errors[0]).toContain("dead-letter");
  });

  it("says a scheduled job will run again, because BullMQ exempts it from the stall budget", async () => {
    const logger = recordingLogger();
    await reportStall({ logger, emit: silentEmit }, "sweeps", "repeat:a.job:1", () =>
      Promise.resolve({
        name: "a.job",
        attemptsStarted: 2,
        stalledCounter: 2,
        opts: { attempts: 1 },
        repeatJobKey: "a.job",
      }),
      1,
    );
    expect(logger.errors[0]).toContain("will run again");
  });
});

describe("reportFailure", () => {
  const { reportFailure } = __testables;

  it("names the job, the run and the attempt, and says a retry is coming", () => {
    const logger = recordingLogger();
    const onJobFailed = vi.fn();
    const emit = (fn: (events: JobEvents) => void | Promise<void>) => void fn({ onJobFailed });

    reportFailure(
      { logger, emit },
      "default",
      { name: "notifications.dispatch", id: "17", attemptsMade: 1, opts: { attempts: 3 } },
      new Error("provider timed out"),
    );

    expect(logger.errors).toEqual([
      'job "notifications.dispatch" failed (run 17, attempt 1/3, will retry):',
    ]);
    expect(onJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "17", attempt: 1, maxAttempts: 3, terminal: false }),
    );
  });

  it("says no retry is left on the last attempt, and marks the dead-letter terminal", () => {
    const logger = recordingLogger();
    const onJobFailed = vi.fn();
    const emit = (fn: (events: JobEvents) => void | Promise<void>) => void fn({ onJobFailed });

    reportFailure(
      { logger, emit },
      "sweeps",
      { name: "kitchen-print.sweep", id: "repeat:kitchen-print.sweep:1", attemptsMade: 1, opts: { attempts: 1 } },
      new Error("job started more than allowable limit"),
    );

    expect(logger.errors[0]).toContain("attempt 1/1, no retry left");
    expect(onJobFailed).toHaveBeenCalledWith(expect.objectContaining({ terminal: true }));
  });

  it("still logs when BullMQ hands over no job, and emits nothing it cannot fill", () => {
    const logger = recordingLogger();
    const onJobFailed = vi.fn();
    const emit = (fn: (events: JobEvents) => void | Promise<void>) => void fn({ onJobFailed });

    reportFailure({ logger, emit }, "default", undefined, new Error("boom"));

    expect(logger.errors).toEqual(['a job on queue "default" failed (run ?):']);
    expect(onJobFailed).not.toHaveBeenCalled();
  });
});
